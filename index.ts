#!/usr/bin/env node
import 'dotenv/config';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import {
  getValidCredentials,
  setupTokenRefresh,
  loadCredentialsQuietly,
} from "./auth.js";
import { tools } from "./tools/index.js";
import { InternalToolResponse } from "./tools/types.js";

const drive = google.drive("v3");

// Global variable to store allowed folder IDs
let allowedFolderIds: Set<string> | null = null;

// Helper function to get all subfolder IDs recursively with depth limit
async function getAllSubfolderIds(rootFolderId: string, maxDepth: number = 3): Promise<Set<string>> {
  const folderIds = new Set<string>([rootFolderId]);
  const foldersToProcess: { id: string; depth: number }[] = [{ id: rootFolderId, depth: 0 }];
  
  while (foldersToProcess.length > 0) {
    const current = foldersToProcess.pop()!;
    
    // Skip if we've reached max depth
    if (current.depth >= maxDepth) {
      continue;
    }
    
    try {
      const res = await drive.files.list({
        q: `'${current.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        pageSize: 100, // Limit to prevent too many folders
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      for (const folder of res.data.files || []) {
        if (!folderIds.has(folder.id!)) {
          folderIds.add(folder.id!);
          // Only add to process if we haven't exceeded folder limit
          if (folderIds.size < 100) { // Limit total folders
            foldersToProcess.push({ id: folder.id!, depth: current.depth + 1 });
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching subfolders for ${current.id}:`, error);
    }
  }
  
  return folderIds;
}

// Helper function to recursively search in folder hierarchy
async function searchInFolderHierarchy(rootFolderId: string, query: string, pageSize: number = 100): Promise<any[]> {
  const allFiles: any[] = [];
  const foldersToSearch = [rootFolderId];
  const searchedFolders = new Set<string>();
  
  while (foldersToSearch.length > 0 && allFiles.length < pageSize) {
    const currentFolderId = foldersToSearch.pop()!;
    if (searchedFolders.has(currentFolderId)) continue;
    searchedFolders.add(currentFolderId);
    
    try {
      // Search files in current folder
      const res = await drive.files.list({
        q: `'${currentFolderId}' in parents and ${query}`,
        fields: 'files(id, name, mimeType, parents)',
        pageSize: pageSize - allFiles.length,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      if (res.data.files) {
        allFiles.push(...res.data.files);
      }
      
      // Get subfolders to search next
      if (allFiles.length < pageSize) {
        const folderRes = await drive.files.list({
          q: `'${currentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
          pageSize: 20, // Limit subfolders per level
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

// Helper function to check if a file is in allowed scope
async function isFileInAllowedScope(fileId: string): Promise<boolean> {
  const file = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true
  });
  
  if (!allowedFolderIds) {
    allowedFolderIds = await getAllSubfolderIds(process.env.GDRIVE_ROOT_FOLDER_ID!);
  }
  
  return file.data.parents?.some(parentId => allowedFolderIds!.has(parentId)) || false;
}

const server = new Server(
  {
    name: "example-servers/gdrive",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {
        schemes: ["gdrive"], // Declare that we handle gdrive:/// URIs
        listable: true, // Support listing available resources
        readable: true, // Support reading resource contents
      },
      tools: {},
    },
  },
);

// Ensure we have valid credentials before making API calls
async function ensureAuth() {
  const auth = await getValidCredentials();
  google.options({ auth });
  return auth;
}

async function ensureAuthQuietly() {
  const auth = await loadCredentialsQuietly();
  if (auth) {
    google.options({ auth });
  }
  return auth;
}

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  await ensureAuthQuietly();
  
  try {
    const rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID!;
    console.error("Listing resources in folder hierarchy starting from:", rootFolderId);
    
    // Use hierarchical search instead of building a huge query
    const pageSize = request.params?.cursor ? 10 : 20; // More on first page
    const files = await searchInFolderHierarchy(
      rootFolderId,
      "trashed = false",
      pageSize
    );
    
    // Note: This simple implementation doesn't support proper pagination
    // For production, you'd need to track folder state in cursor
    
    return {
      resources: files.map((file: any) => ({
        uri: `gdrive:///${file.id}`,
        mimeType: file.mimeType,
        name: file.name,
      })),
      nextCursor: undefined, // Simplified for now
    };
  } catch (error: any) {
    console.error("Error in ListResourcesRequestSchema:", error);
    console.error("Error details:", error.response?.data || error.message);
    
    // Fallback to just root folder on error
    try {
      const rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID!;
      const params: any = {
        pageSize: 10,
        fields: "nextPageToken, files(id, name, mimeType)",
        q: `'${rootFolderId}' in parents and trashed = false`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };
      
      if (request.params?.cursor) {
        params.pageToken = request.params.cursor;
      }
      
      const res = await drive.files.list(params);
      const files = res.data.files || [];
      
      return {
        resources: files.map((file: any) => ({
          uri: `gdrive:///${file.id}`,
          mimeType: file.mimeType,
          name: file.name,
        })),
        nextCursor: res.data.nextPageToken,
      };
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError);
      throw error;
    }
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  await ensureAuthQuietly();
  const fileId = request.params.uri.replace("gdrive:///", "");
  const readFileTool = tools[1]; // gdrive_read_file is the second tool
  const result = await readFileTool.handler({ fileId });

  // Check if there was an error
  if (result.isError) {
    throw new Error(result.content[0].text);
  }

  // Extract the file contents from the tool response
  const fileContents = result.content[0].text.split("\n\n")[1]; // Skip the "Contents of file:" prefix

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain", // You might want to determine this dynamically
        text: fileContents,
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

// Helper function to convert internal tool response to SDK format
function convertToolResponse(response: InternalToolResponse) {
  return {
    _meta: {},
    content: response.content,
    isError: response.isError,
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await ensureAuth();
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    throw new Error("Tool not found");
  }

  const result = await tool.handler(request.params.arguments as any);
  return convertToolResponse(result);
});

async function startServer() {
  try {
    // Check for required environment variable
    if (!process.env.GDRIVE_ROOT_FOLDER_ID) {
      throw new Error("GDRIVE_ROOT_FOLDER_ID environment variable is required");
    }
    
    console.error("Starting server with GDRIVE_ROOT_FOLDER_ID:", process.env.GDRIVE_ROOT_FOLDER_ID);
    
    // Add this line to force authentication at startup
    await ensureAuth(); // This will trigger the auth flow if no valid credentials exist
    
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Set up periodic token refresh that never prompts for auth
    setupTokenRefresh();
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

// Start server immediately
startServer().catch(() => {});
