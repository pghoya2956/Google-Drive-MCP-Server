import { google } from "googleapis";
import { InternalToolResponse } from "./types.js";
import { Readable } from "stream";

export const schema = {
  name: "gdrive_read_large_file",
  description: "Read large files from Google Drive with streaming support",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "ID of the file to read",
      },
      startByte: {
        type: "number",
        description: "Starting byte position (0-based)",
        optional: true,
      },
      endByte: {
        type: "number",
        description: "Ending byte position (inclusive)",
        optional: true,
      },
      maxBytes: {
        type: "number",
        description: "Maximum bytes to read (default: 10MB)",
        optional: true,
      },
      encoding: {
        type: "string",
        description: "Text encoding (default: utf-8)",
        optional: true,
      },
    },
    required: ["fileId"],
  },
} as const;

const drive = google.drive("v3");
const MAX_BYTES_DEFAULT = 10 * 1024 * 1024; // 10MB

// Helper function to check if a file is within the allowed folder hierarchy
async function isFileInAllowedScope(drive: any, fileId: string, rootFolderId: string): Promise<boolean> {
  let currentFileId = fileId;
  const checkedIds = new Set<string>();
  
  while (currentFileId && !checkedIds.has(currentFileId)) {
    checkedIds.add(currentFileId);
    
    try {
      const file = await drive.files.get({
        fileId: currentFileId,
        fields: 'id,parents',
        supportsAllDrives: true
      });
      
      if (file.data.id === rootFolderId) {
        return true;
      }
      
      if (file.data.parents && file.data.parents.length > 0) {
        for (const parentId of file.data.parents) {
          if (parentId === rootFolderId) {
            return true;
          }
        }
        currentFileId = file.data.parents[0];
      } else {
        break;
      }
    } catch (error) {
      console.error(`Error checking file scope for ${currentFileId}:`, error);
      break;
    }
  }
  
  return false;
}

export async function readLargeFile(args: {
  fileId: string;
  startByte?: number;
  endByte?: number;
  maxBytes?: number;
  encoding?: string;
}): Promise<InternalToolResponse> {
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
    // Get file metadata
    const file = await drive.files.get({
      fileId: args.fileId,
      fields: "mimeType,name,size",
      supportsAllDrives: true,
    });

    const fileSize = parseInt(file.data.size || "0");
    const fileName = file.data.name || args.fileId;
    const mimeType = file.data.mimeType || "application/octet-stream";

    // Handle Google Apps files
    if (mimeType.startsWith("application/vnd.google-apps")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Google Apps files (${mimeType}) cannot be streamed. Use gdrive_read_file for these files.`,
          },
        ],
        isError: true,
      };
    }

    // Calculate byte range
    const maxBytes = args.maxBytes || MAX_BYTES_DEFAULT;
    let startByte = args.startByte || 0;
    let endByte = args.endByte;

    if (endByte === undefined) {
      endByte = Math.min(startByte + maxBytes - 1, fileSize - 1);
    } else {
      endByte = Math.min(endByte, fileSize - 1);
    }

    // Validate range
    if (startByte < 0 || startByte >= fileSize) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid start byte ${startByte}. File size is ${fileSize} bytes.`,
          },
        ],
        isError: true,
      };
    }

    // Stream the file with range header
    const response = await drive.files.get(
      {
        fileId: args.fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "stream",
        headers: {
          Range: `bytes=${startByte}-${endByte}`,
        },
      }
    );

    // Read stream into buffer
    const stream = response.data as Readable;
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const content = Buffer.concat(chunks);
    const encoding = args.encoding || "utf-8";
    
    // Prepare response
    let responseText = `File: ${fileName}\n`;
    responseText += `Size: ${fileSize} bytes\n`;
    responseText += `Read: bytes ${startByte}-${endByte} (${endByte - startByte + 1} bytes)\n`;
    responseText += `MIME Type: ${mimeType}\n\n`;

    // Check if content is text
    const isText = mimeType.startsWith("text/") || 
                  mimeType === "application/json" ||
                  mimeType === "application/xml" ||
                  mimeType === "application/javascript";

    if (isText) {
      responseText += "Content:\n";
      responseText += content.toString(encoding as BufferEncoding);
      
      // Add navigation hints
      if (endByte < fileSize - 1) {
        responseText += `\n\n[More content available. Next chunk: startByte=${endByte + 1}]`;
      }
    } else {
      responseText += `Binary content (${content.length} bytes). `;
      responseText += "Use base64 encoding or save to file for binary data.";
    }

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    console.error("Error in gdrive_read_large_file:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error reading large file: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}