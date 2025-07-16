# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2025-01-16

### Added
- PDF file reading support with text extraction
- New dependency: pdf-parse library for PDF processing
- TypeScript type definitions for pdf-parse

### Changed
- Updated gdrive_read_file.ts to handle PDF files specially
- PDF files now return extracted text instead of base64 blob
- Fallback to blob format if PDF parsing fails

## [0.2.1] - Previous version

### Features
- Google Drive file reading with folder scope restrictions
- Google Sheets integration
- Support for Google Docs, Sheets, Slides, and Drawings
- Large file reading capability
- Image analysis functionality
- Folder structure navigation