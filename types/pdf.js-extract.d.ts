declare module 'pdf.js-extract' {
  export interface PDFExtractOptions {
    firstPage?: number;
    lastPage?: number;
    password?: string;
    verbosity?: number;
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }

  export interface PDFExtractResult {
    pages: PDFExtractPage[];
    pdfInfo?: any;
    filename?: string;
    meta?: {
      info?: {
        PDFFormatVersion?: string;
        Title?: string;
        Author?: string;
        Subject?: string;
        Keywords?: string;
        Creator?: string;
        Producer?: string;
        CreationDate?: string;
        ModDate?: string;
      };
      metadata?: any;
    };
  }

  export interface PDFExtractPage {
    pageInfo: {
      num: number;
      scale: number;
      rotation: number;
      offsetX: number;
      offsetY: number;
      width: number;
      height: number;
    };
    content: PDFExtractText[];
  }

  export interface PDFExtractText {
    x: number;
    y: number;
    width: number;
    height: number;
    str: string;
    dir: string;
    fontName: string;
  }

  export class PDFExtract {
    constructor();
    extract(src: string | Buffer, options?: PDFExtractOptions): Promise<PDFExtractResult>;
    extractBuffer(buffer: Buffer, options?: PDFExtractOptions): Promise<PDFExtractResult>;
  }
}