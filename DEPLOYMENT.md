# VLAMy HuggingFace Spaces Deployment Guide

This repository includes two Docker configurations for deploying VLAMy on HuggingFace Spaces, each optimized for different use cases.

## Dockerfile Options

### 1. `Dockerfile` - Full Version with User Authentication

**Use this when you need:**
- User registration and authentication
- Project sharing and collaboration
- Persistent data storage
- Full OCR workflow management
- Admin interface access

**Features:**
- Complete Django authentication system
- SQLite database with migrations
- User profiles and project management
- Admin user automatically created (admin/admin123)
- File uploads and media handling

### 2. `Dockerfile.no-auth` - Browser-Only Version

**Use this when you need:**
- Quick demo or testing environment
- No user registration required
- Simplified deployment
- Browser-based data storage only
- Public access without authentication

**Features:**
- No authentication required
- In-memory database (data doesn't persist between restarts)
- Enhanced browser caching
- Simplified API access
- All CORS origins allowed

## HuggingFace Spaces Deployment

### For Full Version (with users):

1. **Create a new HuggingFace Space:**
   - Go to https://huggingface.co/new-space
   - Choose "Docker" as the SDK
   - Set visibility as desired

2. **Configure the Space:**
   - Upload the `Dockerfile` (rename from `Dockerfile` to `Dockerfile`)
   - Set environment variables in Space settings:
     ```
     SECRET_KEY=your-very-secure-secret-key-here
     DEBUG=False
     ALLOWED_HOSTS=*
     ```

3. **Access the application:**
   - Admin interface: `https://your-space-name.hf.space/admin/`
   - Main app: `https://your-space-name.hf.space/`
   - Default admin credentials: `admin` / `admin123` (change immediately!)

### For Browser-Only Version:

1. **Create a new HuggingFace Space:**
   - Go to https://huggingface.co/new-space
   - Choose "Docker" as the SDK
   - Set visibility as desired

2. **Configure the Space:**
   - Upload the `Dockerfile.no-auth` (rename to `Dockerfile`)
   - No additional environment variables required

3. **Access the application:**
   - Main app: `https://your-space-name.hf.space/`
   - No authentication required - direct access to OCR features

## Key Differences

| Feature | Full Version | Browser-Only |
|---------|-------------|--------------|
| User Authentication | ✅ Required | ❌ Disabled |
| Data Persistence | ✅ SQLite Database | ❌ In-memory only |
| Admin Interface | ✅ Available | ❌ Removed |
| Project Sharing | ✅ Multi-user support | ❌ Single session |
| File Upload Persistence | ✅ Saved to disk | ⚠️ Lost on restart |
| API Access | 🔐 Authenticated | 🌐 Public |
| CORS Policy | 🔒 Restricted origins | 🌐 All origins allowed |
| Startup Time | Slower (migrations) | Faster |
| Memory Usage | Higher | Lower |

## Environment Variables

### Full Version (`Dockerfile`):
```bash
SECRET_KEY=your-secret-key-here
DEBUG=False
ALLOWED_HOSTS=*
OPENAI_API_KEY=your-openai-key  # Optional
CUSTOM_OCR_ENDPOINT=your-endpoint  # Optional
```

### Browser-Only Version (`Dockerfile.no-auth`):
```bash
# No required environment variables
# All settings are optimized for browser-only usage
```

## Local Testing

### Test Full Version:
```bash
docker build -f Dockerfile -t vlamy-full .
docker run -p 7860:7860 vlamy-full
```

### Test Browser-Only Version:
```bash
docker build -f Dockerfile.no-auth -t vlamy-browser .
docker run -p 7860:7860 vlamy-browser
```

## Production Considerations

### Full Version:
- Change the default admin password immediately
- Set a strong `SECRET_KEY`
- Consider using PostgreSQL for larger deployments
- Implement proper backup strategies
- Monitor file storage usage

### Browser-Only Version:
- Data is lost on container restart
- Users should download their work regularly
- Consider implementing local storage warnings
- Monitor memory usage for long sessions

## Troubleshooting

### Common Issues:

1. **Port binding on HuggingFace Spaces:**
   - HuggingFace Spaces expects port 7860
   - Both Dockerfiles are configured correctly

2. **Static files not loading:**
   - Check that `collectstatic` ran successfully
   - Verify `STATIC_ROOT` configuration

3. **Database migrations (Full Version):**
   - Migrations run automatically on startup
   - Check logs if authentication issues occur

4. **Memory issues (Browser-Only):**
   - Restart the space if memory usage is high
   - Data will be lost but performance restored

## Support

For issues specific to VLAMy functionality, please refer to the main repository: https://github.com/wjbmattingly/VLAMy

For HuggingFace Spaces deployment issues, consult the [HuggingFace Spaces documentation](https://huggingface.co/docs/hub/spaces). 