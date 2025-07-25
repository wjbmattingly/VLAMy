from django.db import models
from django.contrib.auth.models import User
from django.core.validators import FileExtensionValidator
from django.utils import timezone
import json
import uuid


# Annotation classification constants based on Segmonto Ontology
ZONE_TYPES = [
    ('CustomZone', 'Custom Zone'),
    ('DamageZone', 'Damage Zone'),
    ('DigitizationArtefactZone', 'Digitization Artefact Zone'),
    ('DropCapitalZone', 'Drop Capital Zone'),
    ('GraphicZone', 'Graphic Zone'),
    ('MainZone', 'Main Zone'),
    ('MarginTextZone', 'Margin Text Zone'),
    ('MusicZone', 'Music Zone'),
    ('NumberingZone', 'Numbering Zone'),
    ('QuireMarksZone', 'Quire Marks Zone'),
    ('RunningTitleZone', 'Running Title Zone'),
    ('SealZone', 'Seal Zone'),
    ('StampZone', 'Stamp Zone'),
    ('TableZone', 'Table Zone'),
    ('TitlePageZone', 'Title Page Zone'),
]

LINE_TYPES = [
    ('CustomLine', 'Custom Line'),
    ('DefaultLine', 'Default Line'),
    ('DropCapitalLine', 'Drop Capital Line'),
    ('HeadingLine', 'Heading Line'),
    ('InterlinearLine', 'Interlinear Line'),
    ('MusicLine', 'Music Line'),
]

# PageXML Region Type mappings
PAGEXML_MAPPINGS = {
    'CustomZone': 'CustomRegion',
    'DamageZone': 'NoiseRegion',
    'DigitizationArtefactZone': 'NoiseRegion',
    'DropCapitalZone': 'TextRegion',
    'GraphicZone': 'GraphicRegion',
    'MainZone': 'TextRegion',
    'MarginTextZone': 'TextRegion',
    'MusicZone': 'MusicRegion',
    'NumberingZone': 'TextRegion',
    'QuireMarksZone': 'TextRegion',
    'RunningTitleZone': 'TextRegion',
    'SealZone': 'ImageRegion',
    'StampZone': 'ImageRegion',
    'TableZone': 'TableRegion',
    'TitlePageZone': 'TextRegion',
    'CustomLine': 'TextLine',
    'DefaultLine': 'TextLine',
    'DropCapitalLine': 'TextLine',
    'HeadingLine': 'TextLine',
    'InterlinearLine': 'TextLine',
    'MusicLine': 'TextLine',
}


class UserProfile(models.Model):
    """Extended user profile for approval system and API credentials"""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    is_approved = models.BooleanField(default=False)
    approval_requested_at = models.DateTimeField(auto_now_add=True)
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='approved_users'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    # API Credentials (stored client-side, cached here for convenience)
    openai_api_key_set = models.BooleanField(default=False)
    custom_endpoint_url = models.URLField(blank=True, null=True)
    custom_endpoint_set = models.BooleanField(default=False)
    
    # Roboflow API Configuration
    roboflow_api_key_set = models.BooleanField(default=False)
    roboflow_workspace_name = models.CharField(
        max_length=100, 
        blank=True, 
        null=True,
        help_text="Roboflow workspace name (e.g., 'text-regions')"
    )
    roboflow_workflow_id = models.CharField(
        max_length=100, 
        blank=True, 
        null=True,
        help_text="Roboflow workflow ID (e.g., 'detect-count-and-visualize')"
    )
    
    # User preferences
    default_reading_order = models.CharField(
        max_length=30,
        choices=[
            ('top_to_bottom_left_to_right', 'Top to Bottom, Left to Right'),
            ('left_to_right_top_to_bottom', 'Left to Right, Top to Bottom'),
            ('bottom_to_top_left_to_right', 'Bottom to Top, Left to Right'),
            ('right_to_left_top_to_bottom', 'Right to Left, Top to Bottom'),
        ],
        default='top_to_bottom_left_to_right'
    )
    
    # Annotation preferences - which classification types are available for this user
    enabled_zone_types = models.JSONField(
        default=list,
        help_text="List of enabled zone types for annotation classification"
    )
    enabled_line_types = models.JSONField(
        default=list,
        help_text="List of enabled line types for annotation classification"
    )
    
    # Custom prompts for transcription
    custom_prompts = models.JSONField(
        default=list,
        help_text="List of custom prompts with associated zones and metadata fields"
    )
    
    # Custom detection mappings (Roboflow class -> UI classification)
    custom_detection_mappings = models.JSONField(
        default=dict,
        help_text="Custom mappings from detection model classes to UI classifications"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.user.username} - {'Approved' if self.is_approved else 'Pending'}"
    
    def save(self, *args, **kwargs):
        """Override save to set default annotation types and prompts if empty"""
        if not self.enabled_zone_types:
            self.enabled_zone_types = [
                'MainZone', 'GraphicZone', 'TableZone', 'DropCapitalZone', 
                'MusicZone', 'MarginTextZone', 'CustomZone'
            ]
        if not self.enabled_line_types:
            self.enabled_line_types = [
                'DefaultLine', 'HeadingLine', 'DropCapitalLine', 
                'InterlinearLine', 'CustomLine'
            ]
        if not self.custom_prompts:
            self.custom_prompts = [
                {
                    'id': 'default_main',
                    'name': 'Main Zone Default',
                    'prompt': 'Transcribe this text accurately, preserving formatting and structure.',
                    'zones': ['MainZone'],
                    'metadata_fields': [
                        {'name': 'handwritten', 'type': 'boolean', 'default': False},
                        {'name': 'typed', 'type': 'boolean', 'default': True},
                        {'name': 'language', 'type': 'string', 'default': 'en'}
                    ],
                    'is_default': True
                }
            ]
        super().save(*args, **kwargs)


class Project(models.Model):
    """Top-level project container"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_projects')
    
    # Sharing settings
    is_public = models.BooleanField(default=False)
    shared_with = models.ManyToManyField(
        User, through='ProjectPermission', related_name='shared_projects',
        through_fields=('project', 'user')
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-updated_at']
    
    def __str__(self):
        return f"{self.name} (by {self.owner.username})"


class ProjectPermission(models.Model):
    """Permissions for project sharing"""
    PERMISSION_CHOICES = [
        ('view', 'View Only'),
        ('edit', 'Edit'),
        ('admin', 'Admin'),
    ]
    
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    permission = models.CharField(max_length=10, choices=PERMISSION_CHOICES, default='view')
    granted_by = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='granted_permissions'
    )
    granted_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['project', 'user']
    
    def __str__(self):
        return f"{self.user.username} - {self.permission} on {self.project.name}"


class Document(models.Model):
    """Document within a project, containing multiple images"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='documents')
    
    # Document-level settings
    reading_order = models.CharField(
        max_length=30,
        choices=[
            ('top_to_bottom_left_to_right', 'Top to Bottom, Left to Right'),
            ('left_to_right_top_to_bottom', 'Left to Right, Top to Bottom'),
            ('bottom_to_top_left_to_right', 'Bottom to Top, Left to Right'),
            ('right_to_left_top_to_bottom', 'Right to Left, Top to Bottom'),
        ],
        null=True, blank=True  # If null, use user's default
    )
    
    # Default transcription settings for new images in this document
    default_transcription_type = models.CharField(
        max_length=20,
        choices=[
            ('full_image', 'Full Image'),
            ('regions_only', 'Regions Only'),
        ],
        default='full_image'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-updated_at']
    
    def __str__(self):
        return f"{self.name} (in {self.project.name})"


class Image(models.Model):
    """Individual image within a document"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='images')
    
    # Image file
    image_file = models.ImageField(
        upload_to='images/%Y/%m/%d/',
        validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'gif'])]
    )
    
    # Image metadata
    original_filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField()  # in bytes
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    
    # Processing status
    is_processed = models.BooleanField(default=False)
    processing_error = models.TextField(blank=True)
    
    # Order within document
    order = models.PositiveIntegerField(default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['order', 'created_at']
        unique_together = ['document', 'order']
    
    def __str__(self):
        return f"{self.name} (in {self.document.name})"


class Annotation(models.Model):
    """Bounding boxes and polygons on images"""
    ANNOTATION_TYPES = [
        ('bbox', 'Bounding Box'),
        ('polygon', 'Polygon'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(Image, on_delete=models.CASCADE, related_name='annotations')
    annotation_type = models.CharField(max_length=10, choices=ANNOTATION_TYPES)
    
    # Coordinates stored as JSON
    # For bbox: {"x": x, "y": y, "width": width, "height": height}
    # For polygon: {"points": [{"x": x1, "y": y1}, {"x": x2, "y": y2}, ...]}
    coordinates = models.JSONField()
    
    # Segmonto Ontology classification
    classification = models.CharField(
        max_length=50, 
        blank=True, 
        null=True,
        help_text="Segmonto Ontology classification (e.g., MainZone, DefaultLine)"
    )
    
    # Optional label/category (free text)
    label = models.CharField(max_length=100, blank=True)
    
    # Metadata for annotations (e.g., handwritten, typed, language)
    metadata = models.JSONField(default=dict, blank=True)
    
    # Order for reading sequence
    reading_order = models.PositiveIntegerField(default=0)
    
    # User who created this annotation
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['reading_order', 'created_at']
    
    def __str__(self):
        classification_str = f" ({self.classification})" if self.classification else ""
        return f"{self.annotation_type}{classification_str} on {self.image.name}"
    
    def get_pagexml_region_type(self):
        """Get the corresponding PageXML region type for this annotation's classification"""
        if self.classification and self.classification in PAGEXML_MAPPINGS:
            return PAGEXML_MAPPINGS[self.classification]
        return 'UnknownRegion'


class Transcription(models.Model):
    """OCR transcription results with version history"""
    TRANSCRIPTION_TYPES = [
        ('full_image', 'Full Image'),
        ('annotation', 'Specific Annotation'),
    ]
    
    TRANSCRIPTION_STATUS = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(Image, on_delete=models.CASCADE, related_name='transcriptions')
    annotation = models.ForeignKey(
        Annotation, on_delete=models.CASCADE, null=True, blank=True,
        related_name='transcriptions'
    )
    
    transcription_type = models.CharField(max_length=20, choices=TRANSCRIPTION_TYPES)
    
    # API details
    api_endpoint = models.CharField(max_length=255)  # 'openai' or custom URL
    api_model = models.CharField(max_length=100, blank=True)  # e.g., 'gpt-4-vision-preview'
    
    # Results
    status = models.CharField(max_length=20, choices=TRANSCRIPTION_STATUS, default='pending')
    text_content = models.TextField(blank=True)
    confidence_score = models.FloatField(null=True, blank=True)
    
    # Metadata
    api_response_raw = models.JSONField(null=True, blank=True)  # Full API response
    processing_time = models.FloatField(null=True, blank=True)  # in seconds
    error_message = models.TextField(blank=True)
    
    # Version control
    version = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    parent_transcription = models.ForeignKey(
        'self', on_delete=models.CASCADE, null=True, blank=True,
        related_name='child_versions'
    )
    
    # User who initiated this transcription
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-version', '-created_at']
    
    def save(self, *args, **kwargs):
        if self.is_current:
            # Ensure only one current transcription per image/annotation combination
            if self.annotation:
                Transcription.objects.filter(
                    annotation=self.annotation, is_current=True
                ).exclude(id=self.id).update(is_current=False)
            else:
                Transcription.objects.filter(
                    image=self.image, annotation__isnull=True, is_current=True
                ).exclude(id=self.id).update(is_current=False)
        
        super().save(*args, **kwargs)
    
    def __str__(self):
        target = self.annotation or self.image
        return f"Transcription v{self.version} for {target}"


class ExportJob(models.Model):
    """Track export job status"""
    EXPORT_TYPES = [
        ('image', 'Single Image'),
        ('document', 'Document'),
        ('project', 'Project'),
    ]
    
    EXPORT_FORMATS = [
        ('json', 'JSON'),
        ('pagexml', 'PageXML'),
        ('zip', 'ZIP with images'),
    ]
    
    EXPORT_STATUS = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    export_type = models.CharField(max_length=20, choices=EXPORT_TYPES)
    export_format = models.CharField(max_length=20, choices=EXPORT_FORMATS)
    status = models.CharField(max_length=20, choices=EXPORT_STATUS, default='pending')
    
    # What to export
    project = models.ForeignKey(Project, on_delete=models.CASCADE, null=True, blank=True)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, null=True, blank=True)
    image = models.ForeignKey(Image, on_delete=models.CASCADE, null=True, blank=True)
    
    # Result
    file_path = models.CharField(max_length=500, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    
    # User who requested export
    requested_by = models.ForeignKey(User, on_delete=models.CASCADE)
    
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    def __str__(self):
        return f"{self.export_format.upper()} export of {self.export_type} - {self.status}"


# Signal to create UserProfile automatically
from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    if hasattr(instance, 'profile'):
        instance.profile.save()
