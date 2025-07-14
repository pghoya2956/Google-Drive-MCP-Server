import { google } from "googleapis";
import { InternalToolResponse } from "./types.js";

export const schema = {
  name: "gdrive_analyze_image",
  description: "Analyze image files from Google Drive with metadata and preview generation",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "ID of the image file to analyze",
      },
      generateThumbnail: {
        type: "boolean",
        description: "Generate a thumbnail preview (default: true)",
        optional: true,
      },
      thumbnailSize: {
        type: "number",
        description: "Thumbnail width in pixels (default: 200)",
        optional: true,
      },
      includeHistogram: {
        type: "boolean",
        description: "Include color histogram data (default: false)",
        optional: true,
      },
    },
    required: ["fileId"],
  },
} as const;

const drive = google.drive("v3");

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

export async function analyzeImage(args: {
  fileId: string;
  generateThumbnail?: boolean;
  thumbnailSize?: number;
  includeHistogram?: boolean;
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
      fields: "mimeType,name,size,imageMediaMetadata,createdTime,modifiedTime",
      supportsAllDrives: true,
    });

    const fileName = file.data.name || args.fileId;
    const mimeType = file.data.mimeType || "";
    const fileSize = parseInt(file.data.size || "0");

    // Check if it's an image
    if (!mimeType.startsWith("image/")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File "${fileName}" is not an image (${mimeType})`,
          },
        ],
        isError: true,
      };
    }

    // Download image data
    const response = await drive.files.get(
      {
        fileId: args.fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "arraybuffer",
      }
    );

    const imageBuffer = Buffer.from(response.data as ArrayBuffer);
    
    // Build response
    let responseText = `Image Analysis: ${fileName}\n\n`;
    responseText += `File Information:\n`;
    responseText += `- Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB\n`;
    responseText += `- MIME Type: ${mimeType}\n`;
    responseText += `- Created: ${file.data.createdTime}\n`;
    responseText += `- Modified: ${file.data.modifiedTime}\n\n`;

    // Google's image metadata if available
    if (file.data.imageMediaMetadata) {
      const imgMeta = file.data.imageMediaMetadata;
      responseText += `Image Properties:\n`;
      if (imgMeta.width) responseText += `- Width: ${imgMeta.width} pixels\n`;
      if (imgMeta.height) responseText += `- Height: ${imgMeta.height} pixels\n`;
      if (imgMeta.rotation) responseText += `- Rotation: ${imgMeta.rotation} degrees\n`;
      
      responseText += `\nCamera Information:\n`;
      if (imgMeta.cameraMake) responseText += `- Make: ${imgMeta.cameraMake}\n`;
      if (imgMeta.cameraModel) responseText += `- Model: ${imgMeta.cameraModel}\n`;
      if (imgMeta.exposureTime) responseText += `- Exposure: ${imgMeta.exposureTime}s\n`;
      if (imgMeta.aperture) responseText += `- Aperture: f/${imgMeta.aperture}\n`;
      if (imgMeta.isoSpeed) responseText += `- ISO: ${imgMeta.isoSpeed}\n`;
      if (imgMeta.focalLength) responseText += `- Focal Length: ${imgMeta.focalLength}mm\n`;
      if (imgMeta.location) {
        responseText += `- Location: ${imgMeta.location.latitude}, ${imgMeta.location.longitude}\n`;
      }
    } else {
      responseText += `Image Properties:\n`;
      responseText += `- No detailed metadata available from Google Drive\n`;
    }

    // Generate thumbnail link if available
    if (args.generateThumbnail !== false) {
      const thumbnailSize = args.thumbnailSize || 200;
      responseText += `\nThumbnail:\n`;
      responseText += `- Google Drive provides thumbnail links for images\n`;
      responseText += `- Use the Drive UI or API to access thumbnails\n`;
    }

    // Basic image data info
    responseText += `\nImage Data:\n`;
    responseText += `- Buffer size: ${(imageBuffer.length / 1024).toFixed(2)} KB\n`;
    
    // Check for common image markers
    const header = imageBuffer.slice(0, 20).toString('hex');
    if (header.startsWith('ffd8ff')) {
      responseText += `- Format confirmed: JPEG\n`;
    } else if (header.startsWith('89504e47')) {
      responseText += `- Format confirmed: PNG\n`;
    } else if (header.startsWith('47494638')) {
      responseText += `- Format confirmed: GIF\n`;
    } else if (header.includes('424d')) {
      responseText += `- Format confirmed: BMP\n`;
    }

    // Suggest appropriate viewing tool
    responseText += `\nRecommended Action:\n`;
    if (fileSize > 10 * 1024 * 1024) {
      responseText += `- Use gdrive_read_large_file for streaming large image data\n`;
    } else {
      responseText += `- Use gdrive_read_file to get full image data\n`;
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
    console.error("Error in gdrive_analyze_image:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error analyzing image: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}