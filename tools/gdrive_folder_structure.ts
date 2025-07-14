import { google } from "googleapis";
import { InternalToolResponse } from "./types.js";
import { withRetry, createErrorResponse } from "./error-handler.js";

export const schema = {
  name: "gdrive_folder_structure",
  description: "Display the entire folder structure of Google Drive in a tree format",
  inputSchema: {
    type: "object",
    properties: {
      folderId: {
        type: "string",
        description: "Folder ID to start from (defaults to root folder)",
        optional: true,
      },
      maxDepth: {
        type: "number",
        description: "Maximum depth to traverse (default: 5)",
        optional: true,
      },
      includeFiles: {
        type: "boolean",
        description: "Include files in the structure (default: false, only folders)",
        optional: true,
      },
      maxItems: {
        type: "number",
        description: "Maximum items per folder (default: 50)",
        optional: true,
      },
    },
    required: [],
  },
} as const;

interface FolderNode {
  id: string;
  name: string;
  mimeType: string;
  children?: FolderNode[];
}

async function buildFolderTree(
  drive: any,
  folderId: string,
  currentDepth: number,
  maxDepth: number,
  includeFiles: boolean,
  maxItems: number
): Promise<FolderNode[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  try {
    // Query for folders with retry logic
    let query = `'${folderId}' in parents and trashed = false`;
    if (!includeFiles) {
      query += " and mimeType = 'application/vnd.google-apps.folder'";
    }

    const res = await withRetry(async () => {
      return await drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType)',
        pageSize: maxItems,
        orderBy: "folder,name",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    });

    const items: FolderNode[] = [];

    for (const file of res.data.files || []) {
      const node: FolderNode = {
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
      };

      // Recursively get children for folders
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        node.children = await buildFolderTree(
          drive,
          file.id!,
          currentDepth + 1,
          maxDepth,
          includeFiles,
          maxItems
        );
      }

      items.push(node);
    }

    return items;
  } catch (error) {
    console.error(`Error building folder tree for ${folderId}:`, error);
    return [];
  }
}

function renderTree(nodes: FolderNode[], prefix: string = "", isLast: boolean[] = []): string {
  let output = "";

  nodes.forEach((node, index) => {
    const isLastItem = index === nodes.length - 1;
    const nodePrefix = isLast.map(last => last ? "    " : "│   ").join("");
    const connector = isLastItem ? "└── " : "├── ";
    
    // Determine icon based on type
    let icon = "📄";
    if (node.mimeType === 'application/vnd.google-apps.folder') {
      icon = "📁";
    } else if (node.mimeType === 'application/vnd.google-apps.spreadsheet') {
      icon = "📊";
    } else if (node.mimeType === 'application/vnd.google-apps.document') {
      icon = "📝";
    }

    output += nodePrefix + connector + icon + " " + node.name + "\n";

    if (node.children && node.children.length > 0) {
      output += renderTree(node.children, prefix + "    ", [...isLast, isLastItem]);
    }
  });

  return output;
}

export async function getFolderStructure(args: {
  folderId?: string;
  maxDepth?: number;
  includeFiles?: boolean;
  maxItems?: number;
}): Promise<InternalToolResponse> {
  const drive = google.drive("v3");

  try {
    const rootFolderId = args.folderId || process.env.GDRIVE_ROOT_FOLDER_ID;
    if (!rootFolderId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: GDRIVE_ROOT_FOLDER_ID environment variable is required",
          },
        ],
        isError: true,
      };
    }

    const maxDepth = args.maxDepth || 5;
    const includeFiles = args.includeFiles || false;
    const maxItems = args.maxItems || 50;

    console.error(`Building folder structure from ${rootFolderId} with maxDepth=${maxDepth}`);

    // Get root folder info
    const rootFile = await drive.files.get({
      fileId: rootFolderId,
      fields: 'id, name',
      supportsAllDrives: true,
    });

    const rootNode: FolderNode = {
      id: rootFile.data.id!,
      name: rootFile.data.name!,
      mimeType: 'application/vnd.google-apps.folder',
      children: await buildFolderTree(drive, rootFolderId, 0, maxDepth, includeFiles, maxItems),
    };

    const treeOutput = "📁 " + rootNode.name + "\n" + renderTree(rootNode.children || []);
    
    const stats = {
      totalFolders: countNodes([rootNode], 'application/vnd.google-apps.folder'),
      totalFiles: includeFiles ? countNodes([rootNode]) - countNodes([rootNode], 'application/vnd.google-apps.folder') : 0,
    };

    let response = `Folder Structure:\n\n${treeOutput}\n`;
    response += `\nSummary: ${stats.totalFolders} folders`;
    if (includeFiles) {
      response += `, ${stats.totalFiles} files`;
    }
    response += `\n(Max depth: ${maxDepth})`;

    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    console.error("Error in gdrive_folder_structure:", error);
    return createErrorResponse(error, "Error getting folder structure");
  }
}

function countNodes(nodes: FolderNode[], mimeType?: string): number {
  let count = 0;
  
  for (const node of nodes) {
    if (!mimeType || node.mimeType === mimeType) {
      count++;
    }
    if (node.children) {
      count += countNodes(node.children, mimeType);
    }
  }
  
  return count;
}