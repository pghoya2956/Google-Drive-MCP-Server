import { google } from "googleapis";
import { GDriveReadFileInput, InternalToolResponse } from "./types.js";
import pdf from "pdf-parse/lib/pdf-parse.js";

export const schema = {
  name: "gdrive_read_file",
  description: "Read contents of a file from Google Drive",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "ID of the file to read",
      },
    },
    required: ["fileId"],
  },
} as const;

const drive = google.drive("v3");

interface FileContent {
  uri?: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

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

export async function readFile(
  args: GDriveReadFileInput,
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
  
  try {
    const result = await readGoogleDriveFile(args.fileId);
    return {
      content: [
        {
          type: "text",
          text: `Contents of ${result.name}:\n\n${result.contents.text || result.contents.blob}`,
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error reading file: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

async function readGoogleDriveFile(
  fileId: string,
): Promise<{ name: string; contents: FileContent }> {
  // First get file metadata to check mime type
  const file = await drive.files.get({
    fileId,
    fields: "mimeType,name",
    supportsAllDrives: true,
  });

  // For Google Docs/Sheets/etc we need to export
  if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
    let exportMimeType: string;
    let isExportable = true;
    
    switch (file.data.mimeType) {
      case "application/vnd.google-apps.document":
        exportMimeType = "text/markdown";
        break;
      case "application/vnd.google-apps.spreadsheet":
        exportMimeType = "text/csv";
        break;
      case "application/vnd.google-apps.presentation":
        exportMimeType = "text/plain";
        break;
      case "application/vnd.google-apps.drawing":
        exportMimeType = "image/png";
        break;
      case "application/vnd.google-apps.folder":
      case "application/vnd.google-apps.form":
      case "application/vnd.google-apps.site":
      case "application/vnd.google-apps.shortcut":
      case "application/vnd.google-apps.map":
      case "application/vnd.google-apps.fusiontable":
        isExportable = false;
        exportMimeType = "";
        break;
      default:
        // Unknown Google Apps type - try as regular file
        isExportable = false;
        exportMimeType = "";
    }

    if (!isExportable) {
      throw new Error(`Cannot read this type of Google Apps file: ${file.data.mimeType}. File type is not exportable.`);
    }

    const res = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" },
    );

    return {
      name: file.data.name || fileId,
      contents: {
        mimeType: exportMimeType,
        text: res.data as string,
      },
    };
  }

  // For regular files download content
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const mimeType = file.data.mimeType || "application/octet-stream";
  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";
  const content = Buffer.from(res.data as ArrayBuffer);

  // Handle PDF files specially
  if (mimeType === "application/pdf") {
    try {
      const pdfData = await pdf(content);
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          text: pdfData.text,
        },
      };
    } catch (error) {
      // If PDF parsing fails, return as blob
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          blob: content.toString("base64"),
        },
      };
    }
  }

  return {
    name: file.data.name || fileId,
    contents: {
      mimeType,
      ...(isText
        ? { text: content.toString("utf-8") }
        : { blob: content.toString("base64") }),
    },
  };
}

