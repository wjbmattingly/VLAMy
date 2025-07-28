# Full Version with User Authentication Support
# Use Python 3.11 slim image for better compatibility
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=7860

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    libmagic1 \
    libmagic-dev \
    file \
    gcc \
    g++ \
    libc6-dev \
    libffi-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libwebp-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Clone the repository
RUN git clone https://github.com/wjbmattingly/VLAMy.git .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create necessary directories
RUN mkdir -p /app/media/imports /app/staticfiles /app/logs

# Set proper permissions
RUN chmod -R 755 /app

# Collect static files
RUN python manage.py collectstatic --noinput

# Run database migrations
RUN python manage.py migrate

# Create a startup script
RUN echo '#!/bin/bash\n\
\n\
# Apply any pending migrations\n\
python manage.py migrate --noinput\n\
\n\
# Create superuser if it does not exist\n\
python manage.py shell -c "\n\
from django.contrib.auth.models import User;\n\
if not User.objects.filter(username=\"admin\").exists():\n\
    User.objects.create_superuser(\"admin\", \"admin@example.com\", \"admin123\")\n\
"\n\
\n\
# Start the Django development server\n\
python manage.py runserver 0.0.0.0:$PORT\n\
' > /app/start.sh && chmod +x /app/start.sh

# Environment variables for production
ENV DEBUG=False
ENV SECRET_KEY="your-secret-key-change-this-in-production"
ENV ALLOWED_HOSTS="*"
ENV DJANGO_SETTINGS_MODULE="vlamy_ocr.settings"

# Expose port
EXPOSE 7860

# Start the application
CMD ["/app/start.sh"] 