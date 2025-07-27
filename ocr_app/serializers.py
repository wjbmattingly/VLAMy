from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from .models import (
    UserProfile, Project, ProjectPermission, Document, 
    Image, Annotation, Transcription, ExportJob
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'date_joined']
        read_only_fields = ['id', 'date_joined']


class UserProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = UserProfile
        fields = [
            'user', 'is_approved', 'approval_requested_at', 'approved_by', 
            'approved_at', 'openai_api_key_set', 'custom_endpoint_url', 
            'custom_endpoint_set', 'roboflow_api_key_set', 'roboflow_workspace_name',
            'roboflow_workflow_id', 'default_reading_order', 'enabled_zone_types',
            'enabled_line_types', 'custom_prompts', 'custom_detection_mappings', 
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'user', 'is_approved', 'approval_requested_at', 'approved_by', 
            'approved_at', 'created_at', 'updated_at'
        ]


class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password_confirm', 'first_name', 'last_name']
    
    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError("Password fields didn't match.")
        return attrs
    
    def create(self, validated_data):
        validated_data.pop('password_confirm')
        user = User.objects.create_user(**validated_data)
        return user


class ProjectPermissionSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    granted_by = UserSerializer(read_only=True)
    
    class Meta:
        model = ProjectPermission
        fields = ['user', 'permission', 'granted_by', 'granted_at']
        read_only_fields = ['granted_by', 'granted_at']


class ProjectListSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    document_count = serializers.SerializerMethodField()
    image_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'owner', 'is_public', 
            'document_count', 'image_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']
    
    def get_document_count(self, obj):
        return obj.documents.count()
    
    def get_image_count(self, obj):
        return sum(doc.images.count() for doc in obj.documents.all())


class ProjectDetailSerializer(ProjectListSerializer):
    permissions = ProjectPermissionSerializer(source='projectpermission_set', many=True, read_only=True)
    shared_with_users = serializers.SerializerMethodField()
    
    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + ['permissions', 'shared_with_users']
    
    def get_shared_with_users(self, obj):
        return [perm.user.username for perm in obj.projectpermission_set.all()]


class DocumentListSerializer(serializers.ModelSerializer):
    project = serializers.StringRelatedField(read_only=True)
    project_id = serializers.UUIDField(write_only=True)
    image_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = [
            'id', 'name', 'description', 'project', 'project_id', 'reading_order', 
            'default_transcription_type', 'image_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_image_count(self, obj):
        return obj.images.count()
    
    def validate_project_id(self, value):
        user = self.context['request'].user
        try:
            project = Project.objects.get(id=value)
            if project.owner != user and not project.projectpermission_set.filter(
                user=user, permission__in=['edit', 'admin']
            ).exists():
                raise serializers.ValidationError("You don't have permission to create documents in this project.")
            return value
        except Project.DoesNotExist:
            raise serializers.ValidationError("Project not found.")


class AnnotationSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    
    class Meta:
        model = Annotation
        fields = [
            'id', 'image', 'annotation_type', 'coordinates', 'classification', 
            'label', 'metadata', 'reading_order', 'created_by', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
    
    def validate_coordinates(self, value):
        annotation_type = self.initial_data.get('annotation_type')
        
        if annotation_type == 'bbox':
            required_fields = ['x', 'y', 'width', 'height']
            if not all(field in value for field in required_fields):
                raise serializers.ValidationError(
                    f"Bounding box requires: {', '.join(required_fields)}"
                )
            if any(not isinstance(value[field], (int, float)) for field in required_fields):
                raise serializers.ValidationError("All coordinates must be numbers")
        
        elif annotation_type == 'polygon':
            if 'points' not in value or not isinstance(value['points'], list):
                raise serializers.ValidationError("Polygon requires 'points' array")
            if len(value['points']) < 3:
                raise serializers.ValidationError("Polygon must have at least 3 points")
            for point in value['points']:
                if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                    raise serializers.ValidationError("Each point must have 'x' and 'y' coordinates")
        
        return value


class TranscriptionSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    annotation = AnnotationSerializer(read_only=True)
    
    class Meta:
        model = Transcription
        fields = [
            'id', 'transcription_type', 'annotation', 'api_endpoint', 'api_model',
            'status', 'text_content', 'confidence_score', 'processing_time',
            'error_message', 'version', 'is_current', 'created_by', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'status', 'confidence_score', 'processing_time', 'error_message',
            'version', 'created_by', 'created_at', 'updated_at'
        ]


class ImageListSerializer(serializers.ModelSerializer):
    document = serializers.StringRelatedField(read_only=True)
    document_id = serializers.UUIDField(write_only=True)
    annotation_count = serializers.SerializerMethodField()
    transcription_count = serializers.SerializerMethodField()
    has_current_transcription = serializers.SerializerMethodField()
    
    class Meta:
        model = Image
        fields = [
            'id', 'name', 'document', 'document_id', 'image_file', 'original_filename',
            'file_size', 'width', 'height', 'is_processed', 'processing_error',
            'order', 'annotation_count', 'transcription_count', 'has_current_transcription',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'original_filename', 'file_size', 'width', 'height', 'is_processed', 'processing_error',
            'created_at', 'updated_at'
        ]
    
    def get_annotation_count(self, obj):
        return obj.annotations.count()
    
    def get_transcription_count(self, obj):
        return obj.transcriptions.count()
    
    def get_has_current_transcription(self, obj):
        return obj.transcriptions.filter(is_current=True, annotation__isnull=True).exists()
    
    def validate_document_id(self, value):
        user = self.context['request'].user
        try:
            document = Document.objects.get(id=value)
            project = document.project
            if project.owner != user and not project.projectpermission_set.filter(
                user=user, permission__in=['edit', 'admin']
            ).exists():
                raise serializers.ValidationError("You don't have permission to add images to this document.")
            return value
        except Document.DoesNotExist:
            raise serializers.ValidationError("Document not found.")


class ImageDetailSerializer(ImageListSerializer):
    annotations = AnnotationSerializer(many=True, read_only=True)
    current_transcription = serializers.SerializerMethodField()
    transcription_history = TranscriptionSerializer(source='transcriptions', many=True, read_only=True)
    
    class Meta(ImageListSerializer.Meta):
        fields = ImageListSerializer.Meta.fields + ['annotations', 'current_transcription', 'transcription_history']
    
    def get_current_transcription(self, obj):
        current = obj.transcriptions.filter(is_current=True, annotation__isnull=True).first()
        if current:
            return TranscriptionSerializer(current).data
        return None


class DocumentDetailSerializer(DocumentListSerializer):
    images = ImageListSerializer(many=True, read_only=True)
    
    class Meta(DocumentListSerializer.Meta):
        fields = DocumentListSerializer.Meta.fields + ['images']


class ExportJobSerializer(serializers.ModelSerializer):
    requested_by = UserSerializer(read_only=True)
    project_name = serializers.SerializerMethodField()
    document_name = serializers.SerializerMethodField()
    image_name = serializers.SerializerMethodField()
    
    class Meta:
        model = ExportJob
        fields = [
            'id', 'export_type', 'export_format', 'status', 'project', 'document', 'image',
            'project_name', 'document_name', 'image_name', 'file_path', 'file_size',
            'error_message', 'requested_by', 'created_at', 'completed_at'
        ]
        read_only_fields = [
            'id', 'status', 'file_path', 'file_size', 'error_message',
            'requested_by', 'created_at', 'completed_at'
        ]
    
    def get_project_name(self, obj):
        return obj.project.name if obj.project else None
    
    def get_document_name(self, obj):
        return obj.document.name if obj.document else None
    
    def get_image_name(self, obj):
        return obj.image.name if obj.image else None
    
    def validate(self, attrs):
        export_type = attrs.get('export_type')
        
        # Ensure exactly one target is specified
        targets = [attrs.get('project'), attrs.get('document'), attrs.get('image')]
        non_null_targets = [t for t in targets if t is not None]
        
        if len(non_null_targets) != 1:
            raise serializers.ValidationError("Exactly one of project, document, or image must be specified.")
        
        # Validate export_type matches the target
        if export_type == 'project' and not attrs.get('project'):
            raise serializers.ValidationError("Project must be specified for project export.")
        elif export_type == 'document' and not attrs.get('document'):
            raise serializers.ValidationError("Document must be specified for document export.")
        elif export_type == 'image' and not attrs.get('image'):
            raise serializers.ValidationError("Image must be specified for image export.")
        
        return attrs


class APICredentialsSerializer(serializers.Serializer):
    """Serializer for handling API credentials (stored client-side)"""
    openai_api_key = serializers.CharField(required=False, allow_blank=True, write_only=True)
    custom_endpoint_url = serializers.URLField(required=False, allow_blank=True)
    custom_endpoint_auth_header = serializers.CharField(required=False, allow_blank=True, write_only=True)
    
    def validate(self, attrs):
        if not attrs.get('openai_api_key') and not attrs.get('custom_endpoint_url'):
            raise serializers.ValidationError(
                "Either OpenAI API key or custom endpoint URL must be provided."
            )
        return attrs


class TranscriptionRequestSerializer(serializers.Serializer):
    """Serializer for requesting transcription"""
    transcription_type = serializers.ChoiceField(choices=Transcription.TRANSCRIPTION_TYPES)
    annotation_id = serializers.UUIDField(required=False, allow_null=True)
    api_endpoint = serializers.CharField(max_length=255)
    api_model = serializers.CharField(max_length=100, required=False, allow_blank=True)
    
    # Client-side credentials (not stored)
    openai_api_key = serializers.CharField(required=False, allow_blank=True, write_only=True)
    custom_endpoint_auth = serializers.CharField(required=False, allow_blank=True, write_only=True)
    
    # Vertex AI credentials
    vertex_access_token = serializers.CharField(required=False, allow_blank=True, write_only=True)
    vertex_project_id = serializers.CharField(required=False, allow_blank=True, write_only=True)
    vertex_location = serializers.CharField(required=False, allow_blank=True, write_only=True)
    vertex_model = serializers.CharField(required=False, allow_blank=True, write_only=True)
    
    # Custom prompt and metadata fields
    custom_prompt = serializers.CharField(required=False, allow_blank=True)
    expected_metadata = serializers.ListField(required=False, allow_empty=True)
    use_structured_output = serializers.BooleanField(required=False, default=False)
    metadata_schema = serializers.JSONField(required=False, allow_null=True)
    
    def validate(self, attrs):
        # For annotation transcription, annotation_id can be provided either in data or via URL
        # So we don't validate it here - the view will handle it
        
        if attrs['api_endpoint'] == 'openai' and not attrs.get('openai_api_key'):
            raise serializers.ValidationError(
                "OpenAI API key is required for OpenAI endpoint."
            )
        
        if attrs['api_endpoint'] == 'vertex' and not all([
            attrs.get('vertex_access_token'),
            attrs.get('vertex_project_id'),
            attrs.get('vertex_location')
        ]):
            raise serializers.ValidationError(
                "Vertex access token, project ID, and location are required for Vertex endpoint."
            )
        
        return attrs 