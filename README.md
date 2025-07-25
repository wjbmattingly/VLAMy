# VLAMy OCR - Vision Language Assistant for My Documents

A comprehensive Django-based OCR (Optical Character Recognition) application that allows users to upload images, annotate regions, and transcribe text using OpenAI's GPT-4 Vision or custom OCR endpoints.

## Features

### 🔐 User Management
- **Admin Approval System**: New user registrations require admin approval
- **User Profiles**: Manage API credentials and preferences
- **Project Sharing**: Share projects with other approved users
- **Permission System**: View, edit, and admin permissions for shared projects

### 📁 Hierarchical Organization
- **Projects**: Top-level containers for organizing work
- **Documents**: Collections of related images within projects
- **Images**: Individual image files with annotations and transcriptions

### 🖼️ Image Annotation
- **Interactive Canvas**: Powered by Fabric.js for smooth annotation experience
- **Bounding Boxes**: Rectangle annotations for text regions
- **Polygons**: Free-form polygon annotations for irregular text areas
- **Visual Tools**: Zoom, pan, and selection tools for precise annotation

### 🤖 AI-Powered Transcription
- **OpenAI Integration**: Use GPT-4 Vision for high-quality text transcription
- **Custom Endpoints**: Support for custom OCR API services
- **Full Image Transcription**: Transcribe entire images at once
- **Region-Specific Transcription**: Transcribe selected annotation regions
- **Version History**: Track and revert transcription changes

### 📤 Export & Data Management
- **Multiple Formats**: Export as JSON, PageXML, or ZIP archives
- **Flexible Scope**: Export individual images, documents, or entire projects
- **Data Preservation**: Complete export includes images, annotations, and transcriptions
- **Version Control**: Maintain history of all transcription edits

### 🔒 Security & Privacy
- **Client-Side Credentials**: API keys stored locally in browser, never on server
- **Secure Authentication**: Token-based authentication system
- **Data Isolation**: Users only access their own data and shared projects
- **Admin Controls**: Comprehensive admin interface for user management

## Installation

### Prerequisites
- Python 3.8+
- Django 5.1+
- Modern web browser with JavaScript enabled

### Quick Start

1. **Clone and Setup**
   ```bash
   cd VLAMy
   conda activate  # or your preferred environment
   pip install -r requirements.txt
   ```

2. **Database Setup**
   ```bash
   python manage.py migrate
   python manage.py createsuperuser
   ```

3. **Run Development Server**
   ```bash
   python manage.py runserver
   ```

4. **Access the Application**
   - Main Application: http://127.0.0.1:8000/
   - Admin Interface: http://127.0.0.1:8000/admin/

### Default Admin Credentials
- **Username**: admin
- **Password**: admin123

⚠️ **Important**: Change the default admin password immediately in production!

## Usage Guide

### Getting Started

1. **Admin Setup**
   - Access the admin interface at `/admin/`
   - Log in with admin credentials
   - Approve user registration requests as they come in

2. **User Registration**
   - Users can register at the main application
   - Accounts require admin approval before access is granted
   - Users receive approval status updates

3. **API Credentials Setup**
   - Click "Configure" in the API Credentials card
   - Add OpenAI API key for GPT-4 Vision transcription
   - Or configure custom OCR endpoint URL and authentication
   - Credentials are stored locally in the browser for security

### Working with Projects

1. **Create a Project**
   - Click the "+" button next to Projects in the sidebar
   - Provide a name and description
   - Projects are private by default

2. **Add Documents**
   - Select a project from the sidebar
   - Create documents to organize related images
   - Set reading order preferences per document

3. **Upload Images**
   - Upload images to documents
   - Supported formats: JPG, PNG, TIFF, BMP, GIF
   - Images are automatically processed for metadata

### Image Annotation Workflow

1. **Select Tools**
   - **Select (1)**: Choose and move existing annotations
   - **Bounding Box (2)**: Draw rectangular regions
   - **Polygon (3)**: Draw free-form shapes

2. **Create Annotations**
   - Click and drag for bounding boxes
   - Click multiple points for polygons (press Escape to finish)
   - Annotations appear in the right panel

3. **Transcribe Text**
   - **Full Image**: Transcribe the entire image
   - **Selected Regions**: Transcribe only selected annotations
   - View results in the transcription panel

### Sharing and Collaboration

1. **Share Projects**
   - Project owners can share with other approved users
   - Set permission levels: View, Edit, or Admin
   - Shared users see projects in their sidebar

2. **Collaborate**
   - Multiple users can work on shared projects
   - All changes are tracked with user attribution
   - Version history maintains complete audit trail

### Data Export

1. **Export Options**
   - **JSON**: Structured data with all annotations and transcriptions
   - **PageXML**: Standard format for document analysis workflows
   - **ZIP**: Complete package with images and data files

2. **Export Scope**
   - Single images with annotations
   - Complete documents with all images
   - Entire projects with full hierarchy

## API Reference

The application provides a RESTful API for programmatic access:

### Authentication
- **POST** `/api/auth/login/` - User login
- **POST** `/api/auth/register/` - User registration
- **GET** `/api/auth/profile/` - User profile

### Projects and Data
- **GET/POST** `/api/projects/` - List/create projects
- **GET/PUT/DELETE** `/api/projects/{id}/` - Project details
- **GET/POST** `/api/documents/` - List/create documents
- **GET/POST** `/api/images/` - List/create images
- **GET/POST** `/api/annotations/` - List/create annotations

### Transcription
- **POST** `/api/images/{id}/transcribe/` - Transcribe full image
- **POST** `/api/annotations/{id}/transcribe/` - Transcribe annotation
- **GET** `/api/transcriptions/` - List transcriptions

### Export
- **POST** `/api/export/image/{id}/` - Export image
- **POST** `/api/export/document/{id}/` - Export document
- **POST** `/api/export/project/{id}/` - Export project
- **GET** `/api/export/download/{job_id}/` - Download export

## Architecture

### Backend (Django)
- **Models**: User management, project hierarchy, annotations, transcriptions
- **Views**: RESTful API endpoints with proper authentication and permissions
- **Services**: OCR processing, export generation, file handling
- **Admin**: Comprehensive interface for user approval and system management

### Frontend (JavaScript + Fabric.js)
- **Single Page Application**: Modern responsive interface
- **Image Annotation**: Interactive canvas with drawing tools
- **Real-time Updates**: Dynamic UI updates without page refreshes
- **Local Storage**: Secure client-side credential management

### Security Features
- **Token Authentication**: Secure API access
- **Permission System**: Granular access control
- **Data Isolation**: User data segregation
- **Input Validation**: Comprehensive request validation
- **XSS Protection**: Cross-site scripting prevention

## Browser-Only Mode

For users who prefer not to run a server, the application supports a browser-only mode:

1. **Client-Side Storage**: Projects and images stored in browser
2. **API Integration**: Direct connection to OCR endpoints
3. **No Backend**: Simplified deployment without server requirements
4. **Data Portability**: Export/import functionality for data management

To enable browser-only mode, set `BROWSER_ONLY_MODE=True` in settings.

## Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

### Code Style
- Follow PEP 8 for Python code
- Use ESLint configuration for JavaScript
- Write descriptive commit messages
- Include documentation for new features

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs and feature requests on GitHub
- **Admin Interface**: Use `/admin/` for user management and system monitoring

---

**VLAMy OCR** - Making document transcription and analysis accessible to everyone. 