import os
import json
import base64
import zipfile
import requests
from io import BytesIO
from datetime import datetime
from PIL import Image as PILImage, ImageDraw
from django.conf import settings
from django.core.files.storage import default_storage
from django.template.loader import render_to_string
import logging

logger = logging.getLogger('ocr_app')


class OCRService:
    """Service for handling OCR transcription requests"""
    
    def __init__(self):
        self.openai_base_url = "https://api.openai.com/v1"
    
    def transcribe_image(self, image_path, api_endpoint, api_key=None, custom_auth=None, api_model=None):
        """
        Transcribe a full image using specified API endpoint
        """
        if api_endpoint == 'openai':
            return self._transcribe_with_openai(image_path, api_key, api_model)
        else:
            return self._transcribe_with_custom_endpoint(
                image_path, api_endpoint, custom_auth, api_model
            )
    
    def transcribe_annotation(self, image_path, annotation, api_endpoint, api_key=None, custom_auth=None, 
                            api_model=None, custom_prompt=None, expected_metadata=None, 
                            use_structured_output=False, metadata_schema=None):
        """
        Transcribe a specific annotation region from an image with custom prompts and metadata extraction
        """
        # Extract the region from the image
        region_image_path = self._extract_annotation_region(image_path, annotation)
        
        try:
            # Transcribe the extracted region
            if api_endpoint == 'openai':
                result = self._transcribe_with_openai(
                    region_image_path, api_key, api_model, custom_prompt, 
                    use_structured_output, metadata_schema
                )
            else:
                result = self._transcribe_with_custom_endpoint(
                    region_image_path, api_endpoint, custom_auth, api_model, 
                    custom_prompt, expected_metadata
                )
            
            # Clean up temporary file
            if os.path.exists(region_image_path):
                os.remove(region_image_path)
            
            return result
            
        except Exception as e:
            # Clean up temporary file even if transcription fails
            if os.path.exists(region_image_path):
                os.remove(region_image_path)
            raise e
    
    def _extract_annotation_region(self, image_path, annotation):
        """
        Extract the region defined by an annotation from the image
        """
        image = PILImage.open(image_path)
        coordinates = annotation.coordinates
        
        if annotation.annotation_type == 'bbox':
            # Extract bounding box region
            x = coordinates['x']
            y = coordinates['y']
            width = coordinates['width']
            height = coordinates['height']
            
            # Crop the image
            region = image.crop((x, y, x + width, y + height))
            
        elif annotation.annotation_type == 'polygon':
            # Extract polygon region
            points = [(point['x'], point['y']) for point in coordinates['points']]
            
            # Create a mask for the polygon
            mask = PILImage.new('L', image.size, 0)
            ImageDraw.Draw(mask).polygon(points, outline=1, fill=1)
            
            # Apply the mask to the image
            region = PILImage.new('RGBA', image.size, (0, 0, 0, 0))
            region.paste(image, mask=mask)
            
            # Crop to the bounding box of the polygon
            bbox = mask.getbbox()
            if bbox:
                region = region.crop(bbox)
        
        # Save the extracted region to a temporary file
        temp_path = f"/tmp/annotation_region_{annotation.id}_{datetime.now().timestamp()}.png"
        region.save(temp_path, 'PNG')
        
        return temp_path
    
    def _transcribe_with_openai(self, image_path, api_key, model=None, custom_prompt=None, 
                               use_structured_output=False, metadata_schema=None):
        """
        Transcribe image using OpenAI Vision API with custom prompts and structured output
        """
        if not api_key:
            raise ValueError("OpenAI API key is required")
        
        # Encode image as base64
        with open(image_path, 'rb') as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        
        # Use custom prompt or default
        prompt_text = custom_prompt or "Please transcribe all text visible in this image. Return only the transcribed text without any additional commentary."
        
        payload = {
            "model": model or "gpt-4o-mini",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_text
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 1000
        }
        
        # Add structured output if requested
        if use_structured_output and metadata_schema:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "transcription_with_metadata",
                    "schema": metadata_schema
                }
            }
        
        response = requests.post(
            f"{self.openai_base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )
        
        if response.status_code != 200:
            raise Exception(f"OpenAI API error: {response.status_code} - {response.text}")
        
        result = response.json()
        
        # Extract text and metadata from response
        text_content = ""
        metadata = {}
        
        if 'choices' in result and len(result['choices']) > 0:
            content = result['choices'][0]['message']['content']
            
            if use_structured_output and metadata_schema:
                try:
                    # Parse JSON response for structured output
                    import json
                    parsed_content = json.loads(content)
                    text_content = parsed_content.get('text', '')
                    metadata = parsed_content.get('metadata', {})
                except json.JSONDecodeError:
                    # Fallback to plain text if JSON parsing fails
                    text_content = content
            else:
                text_content = content
        
        return {
            'text': text_content,
            'metadata': metadata,
            'confidence': None,  # OpenAI doesn't provide confidence scores
            'raw_response': result
        }
    
    def _transcribe_with_custom_endpoint(self, image_path, endpoint_url, auth_header, model=None, 
                                       custom_prompt=None, expected_metadata=None):
        """
        Transcribe image using a custom OCR endpoint with custom prompts and metadata
        """
        headers = {}
        if auth_header:
            headers['Authorization'] = auth_header
        
        # Prepare the image file for upload
        with open(image_path, 'rb') as image_file:
            files = {'image': image_file}
            data = {}
            if model:
                data['model'] = model
            if custom_prompt:
                data['prompt'] = custom_prompt
            if expected_metadata:
                data['expected_metadata'] = json.dumps(expected_metadata)
            
            response = requests.post(
                endpoint_url,
                files=files,
                data=data,
                headers=headers,
                timeout=60
            )
        
        if response.status_code != 200:
            raise Exception(f"Custom API error: {response.status_code} - {response.text}")
        
        result = response.json()
        
        # Try to extract text and metadata from common response formats
        text_content = ""
        confidence = None
        metadata = {}
        
        # Handle structured response with text and metadata
        if isinstance(result, dict) and 'text' in result and 'metadata' in result:
            text_content = result['text']
            metadata = result['metadata']
        # Handle JSON string response (for models that return JSON as text)
        elif isinstance(result, dict) and any(key in result for key in ['text', 'transcription', 'content']):
            if 'text' in result:
                text_content = result['text']
            elif 'transcription' in result:
                text_content = result['transcription']
            elif 'content' in result:
                text_content = result['content']
                
            # Try to parse as JSON if it looks like structured output
            if expected_metadata and text_content.strip().startswith('{'):
                try:
                    parsed = json.loads(text_content)
                    if 'text' in parsed and 'metadata' in parsed:
                        text_content = parsed['text']
                        metadata = parsed['metadata']
                except json.JSONDecodeError:
                    pass  # Keep original text if JSON parsing fails
        else:
            # Fallback for plain string responses
            text_content = str(result) if not isinstance(result, dict) else result.get('result', '')
        
        if 'confidence' in result:
            confidence = result['confidence']
        elif 'score' in result:
            confidence = result['score']
        
        return {
            'text': text_content,
            'metadata': metadata,
            'confidence': confidence,
            'raw_response': result
        }


class ExportService:
    """Service for handling data export functionality"""
    
    def __init__(self):
        self.export_dir = os.path.join(settings.MEDIA_ROOT, 'exports')
        os.makedirs(self.export_dir, exist_ok=True)
    
    def export_image(self, image, export_format):
        """Export single image data"""
        if export_format == 'json':
            return self._export_image_json(image)
        elif export_format == 'pagexml':
            return self._export_image_pagexml(image)
        elif export_format == 'zip':
            return self._export_image_zip(image)
        else:
            raise ValueError(f"Unsupported export format: {export_format}")
    
    def export_document(self, document, export_format):
        """Export document data"""
        if export_format == 'json':
            return self._export_document_json(document)
        elif export_format == 'pagexml':
            return self._export_document_pagexml(document)
        elif export_format == 'zip':
            return self._export_document_zip(document)
        else:
            raise ValueError(f"Unsupported export format: {export_format}")
    
    def export_project(self, project, export_format):
        """Export project data"""
        if export_format == 'json':
            return self._export_project_json(project)
        elif export_format == 'pagexml':
            return self._export_project_pagexml(project)
        elif export_format == 'zip':
            return self._export_project_zip(project)
        else:
            raise ValueError(f"Unsupported export format: {export_format}")
    
    def _export_image_json(self, image):
        """Export image as JSON"""
        # Get current transcription
        current_transcription = image.transcriptions.filter(
            is_current=True, annotation__isnull=True
        ).first()
        
        # Get all annotations with their transcriptions
        annotations_data = []
        for annotation in image.annotations.all():
            annotation_transcription = annotation.transcriptions.filter(is_current=True).first()
            
            annotations_data.append({
                'id': str(annotation.id),
                'type': annotation.annotation_type,
                'coordinates': annotation.coordinates,
                'label': annotation.label,
                'reading_order': annotation.reading_order,
                'transcription': {
                    'text': annotation_transcription.text_content if annotation_transcription else '',
                    'confidence': annotation_transcription.confidence_score if annotation_transcription else None,
                    'created_at': annotation_transcription.created_at.isoformat() if annotation_transcription else None
                } if annotation_transcription else None
            })
        
        data = {
            'image': {
                'id': str(image.id),
                'name': image.name,
                'original_filename': image.original_filename,
                'width': image.width,
                'height': image.height,
                'document': {
                    'id': str(image.document.id),
                    'name': image.document.name,
                    'project': {
                        'id': str(image.document.project.id),
                        'name': image.document.project.name
                    }
                }
            },
            'transcription': {
                'text': current_transcription.text_content if current_transcription else '',
                'confidence': current_transcription.confidence_score if current_transcription else None,
                'created_at': current_transcription.created_at.isoformat() if current_transcription else None
            } if current_transcription else None,
            'annotations': annotations_data,
            'exported_at': datetime.now().isoformat()
        }
        
        filename = f"image_{image.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return filepath
    
    def _export_image_pagexml(self, image):
        """Export image as PageXML format"""
        # Get current transcription
        current_transcription = image.transcriptions.filter(
            is_current=True, annotation__isnull=True
        ).first()
        
        # Get all annotations with their transcriptions
        annotations = image.annotations.all().order_by('reading_order')
        
        context = {
            'image': image,
            'transcription': current_transcription,
            'annotations': annotations,
            'exported_at': datetime.now().isoformat()
        }
        
        # Render PageXML template
        pagexml_content = self._render_pagexml_template(context)
        
        filename = f"image_{image.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(pagexml_content)
        
        return filepath
    
    def _export_image_zip(self, image):
        """Export image with all data as ZIP"""
        # Create temporary directory for ZIP contents
        temp_dir = os.path.join(self.export_dir, f"temp_{image.id}_{datetime.now().timestamp()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            # Export JSON data
            json_path = self._export_image_json(image)
            json_filename = f"{image.name}_data.json"
            os.rename(json_path, os.path.join(temp_dir, json_filename))
            
            # Export PageXML data
            pagexml_path = self._export_image_pagexml(image)
            pagexml_filename = f"{image.name}_pagexml.xml"
            os.rename(pagexml_path, os.path.join(temp_dir, pagexml_filename))
            
            # Copy image file
            if image.image_file and default_storage.exists(image.image_file.name):
                image_filename = f"{image.name}_{image.original_filename}"
                with default_storage.open(image.image_file.name, 'rb') as src:
                    with open(os.path.join(temp_dir, image_filename), 'wb') as dst:
                        dst.write(src.read())
            
            # Create ZIP file
            zip_filename = f"image_{image.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            zip_filepath = os.path.join(self.export_dir, zip_filename)
            
            with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        zipf.write(file_path, file)
            
            return zip_filepath
            
        finally:
            # Clean up temporary directory
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
    
    def _export_document_json(self, document):
        """Export document as JSON"""
        images_data = []
        for image in document.images.all().order_by('order'):
            # Export each image's data
            current_transcription = image.transcriptions.filter(
                is_current=True, annotation__isnull=True
            ).first()
            
            annotations_data = []
            for annotation in image.annotations.all():
                annotation_transcription = annotation.transcriptions.filter(is_current=True).first()
                
                annotations_data.append({
                    'id': str(annotation.id),
                    'type': annotation.annotation_type,
                    'coordinates': annotation.coordinates,
                    'label': annotation.label,
                    'reading_order': annotation.reading_order,
                    'transcription': {
                        'text': annotation_transcription.text_content if annotation_transcription else '',
                        'confidence': annotation_transcription.confidence_score if annotation_transcription else None,
                        'created_at': annotation_transcription.created_at.isoformat() if annotation_transcription else None
                    } if annotation_transcription else None
                })
            
            images_data.append({
                'id': str(image.id),
                'name': image.name,
                'original_filename': image.original_filename,
                'width': image.width,
                'height': image.height,
                'order': image.order,
                'transcription': {
                    'text': current_transcription.text_content if current_transcription else '',
                    'confidence': current_transcription.confidence_score if current_transcription else None,
                    'created_at': current_transcription.created_at.isoformat() if current_transcription else None
                } if current_transcription else None,
                'annotations': annotations_data
            })
        
        data = {
            'document': {
                'id': str(document.id),
                'name': document.name,
                'description': document.description,
                'reading_order': document.reading_order,
                'project': {
                    'id': str(document.project.id),
                    'name': document.project.name
                }
            },
            'images': images_data,
            'exported_at': datetime.now().isoformat()
        }
        
        filename = f"document_{document.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return filepath
    
    def _export_document_zip(self, document):
        """Export document with all images and data as ZIP"""
        # Create temporary directory for ZIP contents
        temp_dir = os.path.join(self.export_dir, f"temp_doc_{document.id}_{datetime.now().timestamp()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            # Export document JSON data
            json_path = self._export_document_json(document)
            json_filename = f"{document.name}_data.json"
            os.rename(json_path, os.path.join(temp_dir, json_filename))
            
            # Export each image
            images_dir = os.path.join(temp_dir, 'images')
            os.makedirs(images_dir, exist_ok=True)
            
            for image in document.images.all().order_by('order'):
                # Copy image file
                if image.image_file and default_storage.exists(image.image_file.name):
                    image_filename = f"{image.order:03d}_{image.name}_{image.original_filename}"
                    with default_storage.open(image.image_file.name, 'rb') as src:
                        with open(os.path.join(images_dir, image_filename), 'wb') as dst:
                            dst.write(src.read())
            
            # Create ZIP file
            zip_filename = f"document_{document.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            zip_filepath = os.path.join(self.export_dir, zip_filename)
            
            with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Get relative path for ZIP
                        rel_path = os.path.relpath(file_path, temp_dir)
                        zipf.write(file_path, rel_path)
            
            return zip_filepath
            
        finally:
            # Clean up temporary directory
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
    
    def _export_project_json(self, project):
        """Export project as JSON"""
        documents_data = []
        for document in project.documents.all():
            images_data = []
            for image in document.images.all().order_by('order'):
                current_transcription = image.transcriptions.filter(
                    is_current=True, annotation__isnull=True
                ).first()
                
                annotations_data = []
                for annotation in image.annotations.all():
                    annotation_transcription = annotation.transcriptions.filter(is_current=True).first()
                    
                    annotations_data.append({
                        'id': str(annotation.id),
                        'type': annotation.annotation_type,
                        'coordinates': annotation.coordinates,
                        'label': annotation.label,
                        'reading_order': annotation.reading_order,
                        'transcription': {
                            'text': annotation_transcription.text_content if annotation_transcription else '',
                            'confidence': annotation_transcription.confidence_score if annotation_transcription else None,
                            'created_at': annotation_transcription.created_at.isoformat() if annotation_transcription else None
                        } if annotation_transcription else None
                    })
                
                images_data.append({
                    'id': str(image.id),
                    'name': image.name,
                    'original_filename': image.original_filename,
                    'width': image.width,
                    'height': image.height,
                    'order': image.order,
                    'transcription': {
                        'text': current_transcription.text_content if current_transcription else '',
                        'confidence': current_transcription.confidence_score if current_transcription else None,
                        'created_at': current_transcription.created_at.isoformat() if current_transcription else None
                    } if current_transcription else None,
                    'annotations': annotations_data
                })
            
            documents_data.append({
                'id': str(document.id),
                'name': document.name,
                'description': document.description,
                'reading_order': document.reading_order,
                'images': images_data
            })
        
        data = {
            'project': {
                'id': str(project.id),
                'name': project.name,
                'description': project.description,
                'owner': project.owner.username,
                'created_at': project.created_at.isoformat()
            },
            'documents': documents_data,
            'exported_at': datetime.now().isoformat()
        }
        
        filename = f"project_{project.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        return filepath
    
    def _export_project_zip(self, project):
        """Export project with all documents, images and data as ZIP"""
        # Create temporary directory for ZIP contents
        temp_dir = os.path.join(self.export_dir, f"temp_proj_{project.id}_{datetime.now().timestamp()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            # Export project JSON data
            json_path = self._export_project_json(project)
            json_filename = f"{project.name}_data.json"
            os.rename(json_path, os.path.join(temp_dir, json_filename))
            
            # Export each document
            for document in project.documents.all():
                doc_dir = os.path.join(temp_dir, f"document_{document.name}")
                os.makedirs(doc_dir, exist_ok=True)
                
                images_dir = os.path.join(doc_dir, 'images')
                os.makedirs(images_dir, exist_ok=True)
                
                for image in document.images.all().order_by('order'):
                    # Copy image file
                    if image.image_file and default_storage.exists(image.image_file.name):
                        image_filename = f"{image.order:03d}_{image.name}_{image.original_filename}"
                        with default_storage.open(image.image_file.name, 'rb') as src:
                            with open(os.path.join(images_dir, image_filename), 'wb') as dst:
                                dst.write(src.read())
            
            # Create ZIP file
            zip_filename = f"project_{project.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            zip_filepath = os.path.join(self.export_dir, zip_filename)
            
            with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Get relative path for ZIP
                        rel_path = os.path.relpath(file_path, temp_dir)
                        zipf.write(file_path, rel_path)
            
            return zip_filepath
            
        finally:
            # Clean up temporary directory
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
    
    def _export_document_pagexml(self, document):
        """Export document as PageXML format"""
        # For now, combine all images into a single PageXML document
        # In a more sophisticated implementation, each image could be a separate page
        
        context = {
            'document': document,
            'images': document.images.all().order_by('order'),
            'exported_at': datetime.now().isoformat()
        }
        
        pagexml_content = self._render_pagexml_template(context)
        
        filename = f"document_{document.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(pagexml_content)
        
        return filepath
    
    def _export_project_pagexml(self, project):
        """Export project as PageXML format"""
        context = {
            'project': project,
            'documents': project.documents.all(),
            'exported_at': datetime.now().isoformat()
        }
        
        pagexml_content = self._render_pagexml_template(context)
        
        filename = f"project_{project.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
        filepath = os.path.join(self.export_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(pagexml_content)
        
        return filepath
    
    def _render_pagexml_template(self, context):
        """Render PageXML template with given context"""
        # Basic PageXML template - can be enhanced with proper PageXML schema
        template = '''<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15">
  <Metadata>
    <Creator>VLAMy OCR Export</Creator>
    <Created>{{ exported_at }}</Created>
  </Metadata>
  {% if image %}
  <Page imageFilename="{{ image.original_filename }}" imageWidth="{{ image.width }}" imageHeight="{{ image.height }}">
    {% if transcription %}
    <TextRegion>
      <TextLine>
        <TextEquiv>
          <Unicode>{{ transcription.text_content }}</Unicode>
        </TextEquiv>
      </TextLine>
    </TextRegion>
    {% endif %}
    {% for annotation in annotations %}
    <TextRegion>
      {% if annotation.annotation_type == 'bbox' %}
      <Coords points="{{ annotation.coordinates.x }},{{ annotation.coordinates.y }} {{ annotation.coordinates.x|add:annotation.coordinates.width }},{{ annotation.coordinates.y }} {{ annotation.coordinates.x|add:annotation.coordinates.width }},{{ annotation.coordinates.y|add:annotation.coordinates.height }} {{ annotation.coordinates.x }},{{ annotation.coordinates.y|add:annotation.coordinates.height }}"/>
      {% elif annotation.annotation_type == 'polygon' %}
      <Coords points="{% for point in annotation.coordinates.points %}{{ point.x }},{{ point.y }}{% if not forloop.last %} {% endif %}{% endfor %}"/>
      {% endif %}
      {% if annotation.transcriptions.current %}
      <TextLine>
        <TextEquiv>
          <Unicode>{{ annotation.transcriptions.current.text_content }}</Unicode>
        </TextEquiv>
      </TextLine>
      {% endif %}
    </TextRegion>
    {% endfor %}
  </Page>
  {% endif %}
</PcGts>'''
        
        from django.template import Template, Context
        t = Template(template)
        return t.render(Context(context))
    
    def export_projects_vlamy(self, projects, export_id):
        """Export multiple projects in VLAMy format"""
        import uuid
        unique_id = str(uuid.uuid4())[:8]
        
        # Create temporary directory for ZIP contents
        temp_dir = os.path.join(self.export_dir, f"temp_vlamy_{export_id}_{datetime.now().timestamp()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        try:
            # Process each project
            for project in projects:
                # Create project directory
                project_dir = os.path.join(temp_dir, self._sanitize_filename(project.name))
                os.makedirs(project_dir, exist_ok=True)
                
                # Create page directory for PageXML files
                page_dir = os.path.join(project_dir, 'page')
                os.makedirs(page_dir, exist_ok=True)
                
                # Process all images in all documents of this project
                for document in project.documents.all():
                    for image in document.images.all().order_by('order'):
                        # Copy original image to project root
                        if image.image_file and default_storage.exists(image.image_file.name):
                            # Use original filename or create a clean one
                            image_filename = image.original_filename
                            if not image_filename:
                                image_filename = f"{image.name}.jpg"
                            
                            # Ensure unique filename if there are duplicates
                            image_path = os.path.join(project_dir, image_filename)
                            counter = 1
                            base_name, ext = os.path.splitext(image_filename)
                            while os.path.exists(image_path):
                                image_filename = f"{base_name}_{counter}{ext}"
                                image_path = os.path.join(project_dir, image_filename)
                                counter += 1
                            
                            with default_storage.open(image.image_file.name, 'rb') as src:
                                with open(image_path, 'wb') as dst:
                                    dst.write(src.read())
                            
                            # Create PageXML file for this image
                            pagexml_filename = f"{os.path.splitext(image_filename)[0]}.xml"
                            pagexml_path = os.path.join(page_dir, pagexml_filename)
                            
                            # Generate PageXML content for this image
                            pagexml_content = self._generate_pagexml_for_image(image, image_filename)
                            
                            with open(pagexml_path, 'w', encoding='utf-8') as f:
                                f.write(pagexml_content)
                
                # Create project metadata JSON
                project_metadata = self._create_project_metadata(project)
                metadata_path = os.path.join(project_dir, 'metadata.json')
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(project_metadata, f, indent=2, ensure_ascii=False)
            
            # Create ZIP file
            zip_filename = f"vlamy_export_{unique_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            zip_filepath = os.path.join(self.export_dir, zip_filename)
            
            with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Get relative path for ZIP
                        rel_path = os.path.relpath(file_path, temp_dir)
                        zipf.write(file_path, rel_path)
            
            return zip_filepath
            
        finally:
            # Clean up temporary directory
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
    
    def export_projects_bulk(self, projects, export_format, export_id):
        """Export multiple projects in specified format (json or pagexml)"""
        import uuid
        unique_id = str(uuid.uuid4())[:8]
        
        if export_format == 'json':
            # Create a single JSON file with all projects
            all_projects_data = {
                'export_info': {
                    'export_id': str(export_id),
                    'unique_id': unique_id,
                    'exported_at': datetime.now().isoformat(),
                    'project_count': len(projects),
                    'format': 'json'
                },
                'projects': []
            }
            
            for project in projects:
                project_data = self._get_project_export_data(project)
                all_projects_data['projects'].append(project_data)
            
            filename = f"bulk_export_{unique_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(self.export_dir, filename)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(all_projects_data, f, indent=2, ensure_ascii=False)
            
            return filepath
            
        elif export_format == 'pagexml':
            # Create a ZIP file with PageXML for each project
            temp_dir = os.path.join(self.export_dir, f"temp_bulk_xml_{export_id}_{datetime.now().timestamp()}")
            os.makedirs(temp_dir, exist_ok=True)
            
            try:
                for project in projects:
                    pagexml_content = self._generate_pagexml_for_project(project)
                    filename = f"{self._sanitize_filename(project.name)}.xml"
                    filepath = os.path.join(temp_dir, filename)
                    
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(pagexml_content)
                
                # Create ZIP file
                zip_filename = f"bulk_pagexml_export_{unique_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
                zip_filepath = os.path.join(self.export_dir, zip_filename)
                
                with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for root, dirs, files in os.walk(temp_dir):
                        for file in files:
                            file_path = os.path.join(root, file)
                            zipf.write(file_path, file)
                
                return zip_filepath
                
            finally:
                # Clean up temporary directory
                import shutil
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
    
    def _sanitize_filename(self, filename):
        """Sanitize filename for cross-platform compatibility"""
        import re
        # Remove or replace invalid characters
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Remove leading/trailing whitespace and periods
        filename = filename.strip(' .')
        # Limit length
        if len(filename) > 100:
            filename = filename[:100]
        return filename or 'unnamed'
    
    def _generate_pagexml_for_image(self, image, image_filename):
        """Generate PageXML content for a single image"""
        from .models import PAGEXML_MAPPINGS
        
        # Get current transcription
        current_transcription = image.transcriptions.filter(
            is_current=True, annotation__isnull=True
        ).first()
        
        # Get all annotations with their transcriptions
        annotations = image.annotations.all().order_by('reading_order')
        
        # Build PageXML content
        pagexml_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15
                           http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15/pagecontent.xsd">
  <Metadata>
    <Creator>VLAMy OCR Export</Creator>
    <Created>{datetime.now().isoformat()}</Created>
    <LastChange>{datetime.now().isoformat()}</LastChange>
  </Metadata>
  <Page imageFilename="{image_filename}" imageWidth="{image.width}" imageHeight="{image.height}">'''
        
        # Add text regions for annotations
        region_id = 1
        for annotation in annotations:
            annotation_transcription = annotation.transcriptions.filter(is_current=True).first()
            
            # Determine region type based on classification
            region_type = PAGEXML_MAPPINGS.get(annotation.classification, 'TextRegion')
            
            pagexml_content += f'''
    <{region_type} id="region_{region_id:04d}">'''
            
            # Add coordinates
            if annotation.annotation_type == 'bbox':
                x = annotation.coordinates['x']
                y = annotation.coordinates['y']
                width = annotation.coordinates['width']
                height = annotation.coordinates['height']
                points = f"{x},{y} {x+width},{y} {x+width},{y+height} {x},{y+height}"
            elif annotation.annotation_type == 'polygon':
                points = " ".join([f"{point['x']},{point['y']}" for point in annotation.coordinates['points']])
            else:
                points = "0,0 100,0 100,100 0,100"  # Fallback
            
            pagexml_content += f'''
      <Coords points="{points}"/>'''
            
            # Add transcription if it's a text region
            if region_type in ['TextRegion', 'CustomRegion'] and annotation_transcription:
                pagexml_content += f'''
      <TextLine id="line_{region_id:04d}_001">
        <Coords points="{points}"/>
        <TextEquiv>
          <Unicode>{self._escape_xml(annotation_transcription.text_content)}</Unicode>
        </TextEquiv>
      </TextLine>'''
            
            pagexml_content += f'''
    </{region_type}>'''
            region_id += 1
        
        # Add full image transcription if available and no annotations
        if current_transcription and not annotations.exists():
            pagexml_content += f'''
    <TextRegion id="region_full">
      <Coords points="0,0 {image.width},0 {image.width},{image.height} 0,{image.height}"/>
      <TextLine id="line_full_001">
        <Coords points="0,0 {image.width},0 {image.width},{image.height} 0,{image.height}"/>
        <TextEquiv>
          <Unicode>{self._escape_xml(current_transcription.text_content)}</Unicode>
        </TextEquiv>
      </TextLine>
    </TextRegion>'''
        
        pagexml_content += '''
  </Page>
</PcGts>'''
        
        return pagexml_content
    
    def _generate_pagexml_for_project(self, project):
        """Generate PageXML content for an entire project"""
        pagexml_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15
                           http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15/pagecontent.xsd">
  <Metadata>
    <Creator>VLAMy OCR Export</Creator>
    <Created>{datetime.now().isoformat()}</Created>
    <LastChange>{datetime.now().isoformat()}</LastChange>
    <Comments>Project: {self._escape_xml(project.name)}</Comments>
  </Metadata>'''
        
        page_id = 1
        for document in project.documents.all():
            for image in document.images.all().order_by('order'):
                pagexml_content += f'''
  <Page imageFilename="{image.original_filename or image.name}" imageWidth="{image.width}" imageHeight="{image.height}" id="page_{page_id:04d}">'''
                
                # Add image content (simplified for project-wide export)
                current_transcription = image.transcriptions.filter(
                    is_current=True, annotation__isnull=True
                ).first()
                
                if current_transcription:
                    pagexml_content += f'''
    <TextRegion id="region_{page_id:04d}_001">
      <Coords points="0,0 {image.width},0 {image.width},{image.height} 0,{image.height}"/>
      <TextLine id="line_{page_id:04d}_001">
        <Coords points="0,0 {image.width},0 {image.width},{image.height} 0,{image.height}"/>
        <TextEquiv>
          <Unicode>{self._escape_xml(current_transcription.text_content)}</Unicode>
        </TextEquiv>
      </TextLine>
    </TextRegion>'''
                
                pagexml_content += '''
  </Page>'''
                page_id += 1
        
        pagexml_content += '''
</PcGts>'''
        
        return pagexml_content
    
    def _escape_xml(self, text):
        """Escape XML special characters"""
        if not text:
            return ""
        return (text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace('"', "&quot;")
                   .replace("'", "&apos;"))
    
    def _create_project_metadata(self, project):
        """Create metadata for a project in the export"""
        return {
            'project_id': str(project.id),
            'name': project.name,
            'description': project.description,
            'owner': project.owner.username,
            'created_at': project.created_at.isoformat(),
            'updated_at': project.updated_at.isoformat(),
            'document_count': project.documents.count(),
            'total_images': sum([doc.images.count() for doc in project.documents.all()]),
            'export_format': 'vlamy',
            'exported_at': datetime.now().isoformat()
        }
    
    def _get_project_export_data(self, project):
        """Get complete project data for JSON export"""
        documents_data = []
        for document in project.documents.all():
            images_data = []
            for image in document.images.all().order_by('order'):
                current_transcription = image.transcriptions.filter(
                    is_current=True, annotation__isnull=True
                ).first()
                
                annotations_data = []
                for annotation in image.annotations.all():
                    annotation_transcription = annotation.transcriptions.filter(is_current=True).first()
                    
                    annotations_data.append({
                        'id': str(annotation.id),
                        'type': annotation.annotation_type,
                        'classification': annotation.classification,
                        'coordinates': annotation.coordinates,
                        'label': annotation.label,
                        'reading_order': annotation.reading_order,
                        'metadata': annotation.metadata,
                        'transcription': {
                            'text': annotation_transcription.text_content if annotation_transcription else '',
                            'confidence': annotation_transcription.confidence_score if annotation_transcription else None,
                            'created_at': annotation_transcription.created_at.isoformat() if annotation_transcription else None
                        } if annotation_transcription else None
                    })
                
                images_data.append({
                    'id': str(image.id),
                    'name': image.name,
                    'original_filename': image.original_filename,
                    'width': image.width,
                    'height': image.height,
                    'order': image.order,
                    'transcription': {
                        'text': current_transcription.text_content if current_transcription else '',
                        'confidence': current_transcription.confidence_score if current_transcription else None,
                        'created_at': current_transcription.created_at.isoformat() if current_transcription else None
                    } if current_transcription else None,
                    'annotations': annotations_data
                })
            
            documents_data.append({
                'id': str(document.id),
                'name': document.name,
                'description': document.description,
                'reading_order': document.reading_order,
                'images': images_data
            })
        
        return {
            'id': str(project.id),
            'name': project.name,
            'description': project.description,
            'owner': project.owner.username,
            'created_at': project.created_at.isoformat(),
            'updated_at': project.updated_at.isoformat(),
            'documents': documents_data
        } 