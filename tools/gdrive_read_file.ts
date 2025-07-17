import { google } from "googleapis";
import { GDriveReadFileInput, InternalToolResponse } from "./types.js";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { pdfCache } from "./cache.js";
import { PDFTableExtractor } from "./pdf-table-extractor.js";

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
    
    // Special handling for PDF files with metadata
    if (result.contents.mimeType === "application/pdf" && result.contents.text) {
      try {
        const pdfData = JSON.parse(result.contents.text);
        let formattedText = `PDF 파일: ${result.name}\n\n`;
        
        // Add metadata section
        formattedText += `📄 메타데이터:\n`;
        formattedText += `- 페이지 수: ${pdfData.metadata.pages}\n`;
        formattedText += `- 파일 크기: ${(pdfData.metadata.fileSize / (1024 * 1024)).toFixed(2)} MB\n`;
        if (pdfData.metadata.title) formattedText += `- 제목: ${pdfData.metadata.title}\n`;
        if (pdfData.metadata.author) formattedText += `- 작성자: ${pdfData.metadata.author}\n`;
        if (pdfData.metadata.createdAt) formattedText += `- 생성일: ${pdfData.metadata.createdAt}\n`;
        if (pdfData.metadata.modifiedAt) formattedText += `- 수정일: ${pdfData.metadata.modifiedAt}\n`;
        
        // Add tables section if available
        if (pdfData.tables && pdfData.tables.length > 0) {
          formattedText += `\n📋 추출된 테이블 (${pdfData.tables.length}개):\n\n`;
          
          for (const table of pdfData.tables) {
            formattedText += `[테이블 ${table.index}]\n`;
            formattedText += table.markdown;
            formattedText += `\n`;
          }
        }
        
        formattedText += `\n📝 텍스트 내용:\n\n${pdfData.text}`;
        
        return {
          content: [
            {
              type: "text",
              text: formattedText,
            },
          ],
          isError: false,
        };
      } catch (e) {
        // If JSON parsing fails, fall back to original text
      }
    }
    
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
    fields: "mimeType,name,modifiedTime,size",
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

  const mimeType = file.data.mimeType || "application/octet-stream";
  
  // Handle PDF files specially with caching
  if (mimeType === "application/pdf") {
    // Generate cache key using fileId and modifiedTime
    const cacheKey = `pdf_${fileId}_${file.data.modifiedTime || 'unknown'}`;
    
    // Check cache first
    const cachedResult = pdfCache.get(cacheKey);
    if (cachedResult) {
      console.log(`Cache hit for PDF file: ${fileId}`);
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          text: JSON.stringify(cachedResult, null, 2),
        },
      };
    }
    
    // Cache miss - download and process the file
    console.log(`Cache miss for PDF file: ${fileId}`);
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const content = Buffer.from(res.data as ArrayBuffer);
    // Check file size limit (20MB)
    const fileSizeMB = content.length / (1024 * 1024);
    if (fileSizeMB > 20) {
      throw new Error(`PDF 파일이 20MB를 초과합니다 (실제: ${fileSizeMB.toFixed(1)} MB). 더 작은 파일을 사용해주세요.`);
    }
    try {
      const pdfData = await pdf(content);
      
      // Check if it's a scanned document (no text extracted)
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        throw new Error("이 PDF는 스캔된 이미지로 구성되어 있어 텍스트를 추출할 수 없습니다.");
      }
      
      // Extract metadata
      const metadata: any = {
        pages: pdfData.numpages,
        fileSize: content.length,
      };
      
      // Add optional metadata fields if available
      if (pdfData.info.Title) metadata.title = pdfData.info.Title;
      if (pdfData.info.Author) metadata.author = pdfData.info.Author;
      if (pdfData.info.CreationDate) metadata.createdAt = pdfData.info.CreationDate;
      if (pdfData.info.ModDate) metadata.modifiedAt = pdfData.info.ModDate;
      if (pdfData.info.Creator) metadata.creator = pdfData.info.Creator;
      if (pdfData.info.Producer) metadata.producer = pdfData.info.Producer;
      if (pdfData.info.Subject) metadata.subject = pdfData.info.Subject;
      if (pdfData.info.Keywords) metadata.keywords = pdfData.info.Keywords;
      
      // Try to extract tables
      let tables: any[] = [];
      try {
        const tableExtractor = new PDFTableExtractor();
        const extractedTables = await tableExtractor.extractTablesFromBuffer(content);
        
        if (extractedTables.length > 0) {
          tables = extractedTables.map((table, index) => ({
            index: index + 1,
            headers: table.headers,
            rows: table.rows,
            markdown: PDFTableExtractor.tableToMarkdown(table),
            json: PDFTableExtractor.tableToJson(table)
          }));
          console.log(`Extracted ${tables.length} table(s) from PDF`);
        }
      } catch (tableError) {
        console.log('Table extraction failed, continuing with text only:', tableError);
      }
      
      // Create structured response
      const pdfResponse = {
        text: pdfData.text,
        metadata: metadata,
        version: pdfData.version,
        tables: tables
      };
      
      // Store in cache
      pdfCache.set(cacheKey, pdfResponse, content.length);
      console.log(`Cached PDF file: ${fileId} (${(content.length / 1024 / 1024).toFixed(2)} MB)`);
      
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          text: JSON.stringify(pdfResponse, null, 2),
        },
      };
    } catch (error) {
      // If PDF parsing fails, provide detailed error messages
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Determine specific error type and provide user-friendly message
      let userMessage = "";
      if (errorMessage.includes("encrypt") || errorMessage.includes("password")) {
        userMessage = "이 PDF는 암호로 보호되어 있습니다.";
      } else if (errorMessage.includes("scanned")) {
        userMessage = errorMessage;
      } else {
        userMessage = `PDF 파싱 오류: ${errorMessage}`;
      }
      
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          blob: content.toString("base64"),
          text: userMessage,
        },
      };
    }
  }

  // For non-PDF regular files, download content
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const content = Buffer.from(res.data as ArrayBuffer);
  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";

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

