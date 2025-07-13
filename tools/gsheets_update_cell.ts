import { google } from "googleapis";
import { GSheetsUpdateCellInput, InternalToolResponse } from "./types.js";

export const schema = {
  name: "gsheets_update_cell",
  description: "Update a cell value in a Google Spreadsheet",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "ID of the spreadsheet",
      },
      range: {
        type: "string",
        description: "Cell range in A1 notation (e.g. 'Sheet1!A1')",
      },
      value: {
        type: "string",
        description: "New cell value",
      },
    },
    required: ["fileId", "range", "value"],
  },
} as const;

// Helper function to check if a file is within the allowed folder hierarchy
async function isFileInAllowedScope(drive: any, fileId: string, rootFolderId: string): Promise<boolean> {
  let currentFileId = fileId;
  const checkedIds = new Set<string>();
  
  // Traverse up the parent hierarchy to see if we reach the root folder
  while (currentFileId && !checkedIds.has(currentFileId)) {
    checkedIds.add(currentFileId);
    
    try {
      const file = await drive.files.get({
        fileId: currentFileId,
        fields: 'id,parents',
        supportsAllDrives: true
      });
      
      // Check if this is the root folder
      if (file.data.id === rootFolderId) {
        return true;
      }
      
      // Check parents
      if (file.data.parents && file.data.parents.length > 0) {
        for (const parentId of file.data.parents) {
          if (parentId === rootFolderId) {
            return true;
          }
        }
        // Continue checking with the first parent
        currentFileId = file.data.parents[0];
      } else {
        // No parents, we've reached the top
        break;
      }
    } catch (error) {
      console.error(`Error checking file scope for ${currentFileId}:`, error);
      break;
    }
  }
  
  return false;
}

export async function updateCell(
  args: GSheetsUpdateCellInput,
): Promise<InternalToolResponse> {
  // Check environment variable
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
  
  // Check if file is in allowed scope
  const drive = google.drive("v3");
  const isAllowed = await isFileInAllowedScope(drive, args.fileId, rootFolderId);
  
  if (!isAllowed) {
    return {
      content: [
        {
          type: "text",
          text: "Error: This file is outside the allowed folder scope",
        },
      ],
      isError: true,
    };
  }
  
  const { fileId, range, value } = args;
  const sheets = google.sheets({ version: "v4" });

  await sheets.spreadsheets.values.update({
    spreadsheetId: fileId,
    range: range,
    valueInputOption: "RAW",
    requestBody: {
      values: [[value]],
    },
  });

  return {
    content: [
      {
        type: "text",
        text: `Updated cell ${range} to value: ${value}`,
      },
    ],
    isError: false,
  };
}

