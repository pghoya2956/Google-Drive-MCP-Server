import { google } from "googleapis";
import { GDriveSearchInput, InternalToolResponse } from "./types.js";

export const schema = {
  name: "gdrive_search",
  description: "Search for files in Google Drive",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
      pageToken: {
        type: "string",
        description: "Token for the next page of results",
        optional: true,
      },
      pageSize: {
        type: "number",
        description: "Number of results per page (max 100)",
        optional: true,
      },
      driveId: {
        type: "string",
        description: "ID of a specific shared drive to search in",
        optional: true,
      },
    },
    required: ["query"],
  },
} as const;

// Helper function to recursively search in folder hierarchy
async function searchInFolderHierarchy(
  drive: any,
  rootFolderId: string,
  searchConditions: string,
  pageSize: number = 100
): Promise<any[]> {
  const allFiles: any[] = [];
  const foldersToSearch = [rootFolderId];
  const searchedFolders = new Set<string>();
  
  while (foldersToSearch.length > 0 && allFiles.length < pageSize) {
    const currentFolderId = foldersToSearch.pop()!;
    if (searchedFolders.has(currentFolderId)) continue;
    searchedFolders.add(currentFolderId);
    
    try {
      // Search files in current folder
      const query = `'${currentFolderId}' in parents and ${searchConditions}`;
      const res = await drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType, modifiedTime, size)',
        pageSize: Math.min(50, pageSize - allFiles.length),
        orderBy: "modifiedTime desc",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      if (res.data.files) {
        allFiles.push(...res.data.files);
      }
      
      // Get subfolders to search next (only if we need more results)
      if (allFiles.length < pageSize) {
        const folderRes = await drive.files.list({
          q: `'${currentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
          pageSize: 10, // Limit subfolders per level
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        
        for (const folder of folderRes.data.files || []) {
          if (!searchedFolders.has(folder.id!)) {
            foldersToSearch.push(folder.id!);
          }
        }
      }
    } catch (error) {
      console.error(`Error searching in folder ${currentFolderId}:`, error);
    }
  }
  
  return allFiles;
}

export async function search(
  args: GDriveSearchInput,
): Promise<InternalToolResponse> {
  const drive = google.drive("v3");
  
  try {
    // Get root folder ID
    const rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID;
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
    
    const userQuery = args.query.trim();
    let searchConditions = "trashed = false";
    
    if (userQuery) {
      // Escape special characters in the query
      const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const conditions = [];

      // Search in title
      conditions.push(`name contains '${escapedQuery}'`);

      // If specific file type is mentioned in query, add mimeType condition
      if (userQuery.toLowerCase().includes("sheet")) {
        conditions.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
      }

      searchConditions = `(${conditions.join(" or ")}) and trashed = false`;
    }
    
    console.error(`Searching in folder hierarchy with query: ${searchConditions}`);
    
    // Use hierarchical search
    const files = await searchInFolderHierarchy(
      drive,
      rootFolderId,
      searchConditions,
      args.pageSize || 10
    );

    const fileList = files
      .map((file: any) => `${file.id} ${file.name} (${file.mimeType})`)
      .join("\n");

    let response = `Found ${files.length} files:\n${fileList}`;

    // Note: Pagination not implemented in this simplified version
    
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
    console.error("Error in gdrive_search:", error);
    console.error("Error details:", error.response?.data || error.message);
    return {
      content: [
        {
          type: "text",
          text: `Error searching files: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
