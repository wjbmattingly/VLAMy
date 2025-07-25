import os
import json
import time
import requests
import zipfile
from io import BytesIO
from PIL import Image as PILImage

from django.shortcuts import render
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.db.models import Q, Count
from django.http import HttpResponse, Http404
from django.utils import timezone
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.authtoken.models import Token
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .models import (
    UserProfile, Project, ProjectPermission, Document, 
    Image, Annotation, Transcription, ExportJob,
    ZONE_TYPES, LINE_TYPES, PAGEXML_MAPPINGS
)
from .serializers import (
    UserSerializer, UserProfileSerializer, UserRegistrationSerializer,
    ProjectListSerializer, ProjectDetailSerializer, ProjectPermissionSerializer,
    DocumentListSerializer, DocumentDetailSerializer,
    ImageListSerializer, ImageDetailSerializer, 
    AnnotationSerializer, TranscriptionSerializer, ExportJobSerializer,
    APICredentialsSerializer, TranscriptionRequestSerializer
)
from .services import OCRService, ExportService
from .permissions import IsOwnerOrSharedUser, IsApprovedUser


class UserRegistrationView(APIView):
    """User registration endpoint - creates pending approval account"""
    permission_classes = [AllowAny]
    
    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            # UserProfile is automatically created via signals
            return Response({
                'message': 'Registration successful. Your account is pending admin approval.',
                'user_id': user.id,
                'username': user.username
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@method_decorator(csrf_exempt, name='dispatch')
class CustomLoginView(APIView):
    """Custom login endpoint that handles JSON authentication"""
    permission_classes = [AllowAny]
    
    def post(self, request):
        username = request.data.get('username')
        password = request.data.get('password')
        
        if not username or not password:
            return Response({
                'error': 'Please provide both username and password'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        user = authenticate(username=username, password=password)
        if user:
            if not user.is_active:
                return Response({
                    'error': 'Account is disabled'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Check if user has a profile and is approved
            try:
                profile = user.profile
                if not profile.is_approved and not user.is_superuser:
                    return Response({
                        'error': 'Account is pending admin approval'
                    }, status=status.HTTP_400_BAD_REQUEST)
            except:
                # Create profile if it doesn't exist (for superusers)
                if user.is_superuser:
                    UserProfile.objects.create(user=user, is_approved=True)
                else:
                    return Response({
                        'error': 'Account setup incomplete'
                    }, status=status.HTTP_400_BAD_REQUEST)
            
            token, created = Token.objects.get_or_create(user=user)
            return Response({
                'token': token.key,
                'user_id': user.id,
                'username': user.username
            })
        else:
            return Response({
                'error': 'Invalid credentials'
            }, status=status.HTTP_400_BAD_REQUEST)


class UserProfileView(APIView):
    """Get and update user profile"""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        serializer = UserProfileSerializer(request.user.profile)
        return Response(serializer.data)
    
    def patch(self, request):
        serializer = UserProfileSerializer(
            request.user.profile, 
            data=request.data, 
            partial=True
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class APICredentialsView(APIView):
    """Handle API credentials (stored client-side)"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request):
        serializer = APICredentialsSerializer(data=request.data)
        if serializer.is_valid():
            # Update profile flags (credentials not stored server-side)
            profile = request.user.profile
            if serializer.validated_data.get('openai_api_key'):
                profile.openai_api_key_set = True
            if serializer.validated_data.get('custom_endpoint_url'):
                profile.custom_endpoint_url = serializer.validated_data['custom_endpoint_url']
                profile.custom_endpoint_set = True
            profile.save()
            
            return Response({'message': 'Credentials updated successfully'})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class AnnotationTypesView(APIView):
    """Get available annotation types and user's enabled types"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request):
        """Return all available annotation types and user's enabled types"""
        user_profile = request.user.profile
        
        return Response({
            'all_types': {
                'zones': [{'value': code, 'label': label} for code, label in ZONE_TYPES],
                'lines': [{'value': code, 'label': label} for code, label in LINE_TYPES],
            },
            'user_enabled': {
                'zones': user_profile.enabled_zone_types or [],
                'lines': user_profile.enabled_line_types or [],
            },
            'pagexml_mappings': PAGEXML_MAPPINGS
        })


class UserSearchView(APIView):
    """Search users for sharing purposes"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request):
        query = request.query_params.get('q', '')
        if len(query) < 2:
            return Response({'results': []})
        
        users = User.objects.filter(
            Q(username__icontains=query) | 
            Q(email__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query),
            profile__is_approved=True
        ).exclude(id=request.user.id)[:10]
        
        serializer = UserSerializer(users, many=True)
        return Response({'results': serializer.data})


class ProjectViewSet(viewsets.ModelViewSet):
    """CRUD operations for projects"""
    permission_classes = [IsAuthenticated, IsApprovedUser, IsOwnerOrSharedUser]
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ProjectDetailSerializer
        return ProjectListSerializer
    
    def get_queryset(self):
        user = self.request.user
        return Project.objects.filter(
            Q(owner=user) | Q(shared_with=user)
        ).distinct().select_related('owner').prefetch_related('documents')
    
    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
    
    @action(detail=False, methods=['delete'])
    def bulk_delete(self, request):
        """Delete multiple projects"""
        project_ids = request.data.get('project_ids', [])
        if not project_ids:
            return Response({'error': 'No project IDs provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get projects the user can delete (only owners can delete projects)
        queryset = Project.objects.filter(
            id__in=project_ids,
            owner=request.user
        )
        
        if queryset.count() != len(project_ids):
            return Response(
                {'error': 'You can only delete projects you own'}, 
                status=status.HTTP_403_FORBIDDEN
            )
        
        deleted_count = queryset.count()
        queryset.delete()
        
        return Response({
            'message': f'Successfully deleted {deleted_count} projects',
            'deleted_count': deleted_count
        })


class ProjectPermissionView(APIView):
    """Manage project permissions"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request, pk):
        try:
            project = Project.objects.get(pk=pk)
            if project.owner != request.user:
                return Response(
                    {'error': 'Only project owner can view permissions'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            permissions = project.projectpermission_set.all()
            serializer = ProjectPermissionSerializer(permissions, many=True)
            return Response(serializer.data)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)


class ShareProjectView(APIView):
    """Share project with another user"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, pk):
        try:
            project = Project.objects.get(pk=pk)
            if project.owner != request.user:
                return Response(
                    {'error': 'Only project owner can share projects'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            username = request.data.get('username')
            permission_level = request.data.get('permission', 'view')
            
            try:
                user_to_share = User.objects.get(username=username, profile__is_approved=True)
            except User.DoesNotExist:
                return Response(
                    {'error': 'User not found or not approved'}, 
                    status=status.HTTP_404_NOT_FOUND
                )
            
            permission, created = ProjectPermission.objects.get_or_create(
                project=project,
                user=user_to_share,
                defaults={
                    'permission': permission_level,
                    'granted_by': request.user
                }
            )
            
            if not created:
                permission.permission = permission_level
                permission.save()
            
            serializer = ProjectPermissionSerializer(permission)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
            
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)
    
    def delete(self, request, pk):
        """Remove user access to project"""
        try:
            project = Project.objects.get(pk=pk)
            if project.owner != request.user:
                return Response(
                    {'error': 'Only project owner can remove access'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            username = request.data.get('username')
            try:
                user_to_remove = User.objects.get(username=username)
                ProjectPermission.objects.filter(
                    project=project, user=user_to_remove
                ).delete()
                return Response({'message': 'Access removed successfully'})
            except User.DoesNotExist:
                return Response(
                    {'error': 'User not found'}, 
                    status=status.HTTP_404_NOT_FOUND
                )
                
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)


class DocumentViewSet(viewsets.ModelViewSet):
    """CRUD operations for documents"""
    permission_classes = [IsAuthenticated, IsApprovedUser, IsOwnerOrSharedUser]
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return DocumentDetailSerializer
        return DocumentListSerializer
    
    def get_queryset(self):
        user = self.request.user
        queryset = Document.objects.filter(
            Q(project__owner=user) | Q(project__shared_with=user)
        ).distinct().select_related('project').prefetch_related('images')
        
        # Filter by project if specified
        project_id = self.request.query_params.get('project', None)
        if project_id:
            queryset = queryset.filter(project__id=project_id)
            
        return queryset
    
    @action(detail=False, methods=['delete'])
    def bulk_delete(self, request):
        """Delete multiple documents"""
        document_ids = request.data.get('document_ids', [])
        if not document_ids:
            return Response({'error': 'No document IDs provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get documents the user can delete
        queryset = self.get_queryset().filter(id__in=document_ids)
        
        # Check if user has edit/admin permission for all documents
        for doc in queryset:
            if not (doc.project.owner == request.user or 
                   doc.project.projectpermission_set.filter(
                       user=request.user, permission__in=['edit', 'admin']
                   ).exists()):
                return Response(
                    {'error': f'Permission denied for document: {doc.name}'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
        
        deleted_count = queryset.count()
        queryset.delete()
        
        return Response({
            'message': f'Successfully deleted {deleted_count} documents',
            'deleted_count': deleted_count
        })


class ImageViewSet(viewsets.ModelViewSet):
    """CRUD operations for images"""
    permission_classes = [IsAuthenticated, IsApprovedUser, IsOwnerOrSharedUser]
    parser_classes = [MultiPartParser, FormParser]
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ImageDetailSerializer
        return ImageListSerializer
    
    def get_queryset(self):
        user = self.request.user
        queryset = Image.objects.filter(
            Q(document__project__owner=user) | Q(document__project__shared_with=user)
        ).distinct().select_related('document__project').prefetch_related('annotations', 'transcriptions')
        
        # Filter by document if specified
        document_id = self.request.query_params.get('document', None)
        if document_id:
            queryset = queryset.filter(document__id=document_id)
            
        # Filter by project if specified
        project_id = self.request.query_params.get('project', None)
        if project_id:
            queryset = queryset.filter(document__project__id=project_id)
            
        return queryset
    
    @action(detail=False, methods=['delete'])
    def bulk_delete(self, request):
        """Delete multiple images"""
        image_ids = request.data.get('image_ids', [])
        if not image_ids:
            return Response({'error': 'No image IDs provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get images the user can delete
        queryset = self.get_queryset().filter(id__in=image_ids)
        
        # Check if user has edit/admin permission for all images
        for img in queryset:
            if not (img.document.project.owner == request.user or 
                   img.document.project.projectpermission_set.filter(
                       user=request.user, permission__in=['edit', 'admin']
                   ).exists()):
                return Response(
                    {'error': f'Permission denied for image: {img.name}'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
        
        deleted_count = queryset.count()
        queryset.delete()
        
        return Response({
            'message': f'Successfully deleted {deleted_count} images',
            'deleted_count': deleted_count
        })
    
    def perform_create(self, serializer):
        # Extract image metadata
        image_file = serializer.validated_data['image_file']
        
        # Get image dimensions and file size
        pil_image = PILImage.open(image_file)
        width, height = pil_image.size
        file_size = image_file.size
        
        serializer.save(
            original_filename=image_file.name,
            width=width,
            height=height,
            file_size=file_size
        )


class ImageUploadView(APIView):
    """Handle image file uploads with metadata extraction"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    parser_classes = [MultiPartParser, FormParser]
    
    def post(self, request, pk):
        try:
            image = Image.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (image.document.project.owner == user or 
                   image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            if 'image_file' not in request.FILES:
                return Response(
                    {'error': 'No image file provided'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            image_file = request.FILES['image_file']
            
            # Validate file type
            try:
                pil_image = PILImage.open(image_file)
                width, height = pil_image.size
            except Exception as e:
                return Response(
                    {'error': 'Invalid image file'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Update image
            image.image_file = image_file
            image.original_filename = image_file.name
            image.width = width
            image.height = height
            image.file_size = image_file.size
            image.is_processed = True
            image.save()
            
            serializer = ImageDetailSerializer(image)
            return Response(serializer.data)
            
        except Image.DoesNotExist:
            return Response({'error': 'Image not found'}, status=status.HTTP_404_NOT_FOUND)


class AnnotationViewSet(viewsets.ModelViewSet):
    """CRUD operations for annotations"""
    permission_classes = [IsAuthenticated, IsApprovedUser, IsOwnerOrSharedUser]
    serializer_class = AnnotationSerializer
    
    def get_queryset(self):
        user = self.request.user
        return Annotation.objects.filter(
            Q(image__document__project__owner=user) | 
            Q(image__document__project__shared_with=user)
        ).distinct().select_related('image__document__project', 'created_by')
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ImageAnnotationsView(APIView):
    """Get all annotations for a specific image"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request, pk):
        try:
            image = Image.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (image.document.project.owner == user or 
                   image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            annotations = image.annotations.all().order_by('reading_order', 'created_at')
            serializer = AnnotationSerializer(annotations, many=True)
            return Response(serializer.data)
            
        except Image.DoesNotExist:
            return Response({'error': 'Image not found'}, status=status.HTTP_404_NOT_FOUND)


class ReorderAnnotationsView(APIView):
    """Reorder annotations for a specific image"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, pk):
        try:
            image = Image.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (image.document.project.owner == user or 
                   image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            annotations_data = request.data.get('annotations', [])
            if not annotations_data:
                return Response(
                    {'error': 'Annotations data required'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Update reading orders
            for annotation_data in annotations_data:
                annotation_id = annotation_data.get('id')
                reading_order = annotation_data.get('reading_order')
                
                if annotation_id is not None and reading_order is not None:
                    try:
                        annotation = Annotation.objects.get(id=annotation_id, image=image)
                        annotation.reading_order = reading_order
                        annotation.save()
                    except Annotation.DoesNotExist:
                        continue
            
            return Response({'message': 'Annotation order updated successfully'})
            
        except Image.DoesNotExist:
            return Response({'error': 'Image not found'}, status=status.HTTP_404_NOT_FOUND)


class TranscriptionViewSet(viewsets.ModelViewSet):
    """CRUD operations for transcriptions"""
    permission_classes = [IsAuthenticated, IsApprovedUser, IsOwnerOrSharedUser]
    serializer_class = TranscriptionSerializer
    
    def get_queryset(self):
        user = self.request.user
        return Transcription.objects.filter(
            Q(image__document__project__owner=user) | 
            Q(image__document__project__shared_with=user)
        ).distinct().select_related('image__document__project', 'created_by', 'annotation')


class TranscribeImageView(APIView):
    """Transcribe full image using OCR API"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, pk):
        try:
            image = Image.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (image.document.project.owner == user or 
                   image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            serializer = TranscriptionRequestSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
            # Create transcription record
            transcription = Transcription.objects.create(
                image=image,
                transcription_type='full_image',
                api_endpoint=serializer.validated_data['api_endpoint'],
                api_model=serializer.validated_data.get('api_model', ''),
                status='processing',
                created_by=user
            )
            
            # Process OCR asynchronously (for now, synchronously)
            ocr_service = OCRService()
            try:
                start_time = time.time()
                result = ocr_service.transcribe_image(
                    image_path=image.image_file.path,
                    api_endpoint=serializer.validated_data['api_endpoint'],
                    api_key=serializer.validated_data.get('openai_api_key'),
                    custom_auth=serializer.validated_data.get('custom_endpoint_auth'),
                    api_model=serializer.validated_data.get('api_model')
                )
                processing_time = time.time() - start_time
                
                transcription.status = 'completed'
                transcription.text_content = result.get('text', '')
                transcription.confidence_score = result.get('confidence')
                transcription.api_response_raw = result
                transcription.processing_time = processing_time
                transcription.save()
                
            except Exception as e:
                transcription.status = 'failed'
                transcription.error_message = str(e)
                transcription.save()
                return Response(
                    {'error': f'Transcription failed: {str(e)}'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            return Response(TranscriptionSerializer(transcription).data)
            
        except Image.DoesNotExist:
            return Response({'error': 'Image not found'}, status=status.HTTP_404_NOT_FOUND)


class TranscribeAnnotationView(APIView):
    """Transcribe specific annotation region"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, pk):
        try:
            annotation = Annotation.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (annotation.image.document.project.owner == user or 
                   annotation.image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            serializer = TranscriptionRequestSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
            # Create transcription record
            transcription = Transcription.objects.create(
                image=annotation.image,
                annotation=annotation,
                transcription_type='annotation',
                api_endpoint=serializer.validated_data['api_endpoint'],
                api_model=serializer.validated_data.get('api_model', ''),
                status='processing',
                created_by=user
            )
            
            # Process OCR for annotation region
            ocr_service = OCRService()
            try:
                start_time = time.time()
                result = ocr_service.transcribe_annotation(
                    image_path=annotation.image.image_file.path,
                    annotation=annotation,
                    api_endpoint=serializer.validated_data['api_endpoint'],
                    api_key=serializer.validated_data.get('openai_api_key'),
                    custom_auth=serializer.validated_data.get('custom_endpoint_auth'),
                    api_model=serializer.validated_data.get('api_model'),
                    custom_prompt=serializer.validated_data.get('custom_prompt'),
                    expected_metadata=serializer.validated_data.get('expected_metadata', []),
                    use_structured_output=serializer.validated_data.get('use_structured_output', False),
                    metadata_schema=serializer.validated_data.get('metadata_schema')
                )
                processing_time = time.time() - start_time
                
                transcription.status = 'completed'
                transcription.text_content = result.get('text', '')
                transcription.confidence_score = result.get('confidence')
                transcription.api_response_raw = result
                transcription.processing_time = processing_time
                transcription.save()
                
                # Update annotation metadata if provided
                if result.get('metadata'):
                    annotation.metadata = {**annotation.metadata, **result['metadata']}
                    annotation.save()
                
            except Exception as e:
                transcription.status = 'failed'
                transcription.error_message = str(e)
                transcription.save()
                return Response(
                    {'error': f'Transcription failed: {str(e)}'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            return Response(TranscriptionSerializer(transcription).data)
            
        except Annotation.DoesNotExist:
            return Response({'error': 'Annotation not found'}, status=status.HTTP_404_NOT_FOUND)


class RevertTranscriptionView(APIView):
    """Revert to a previous transcription version"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, pk):
        try:
            transcription = Transcription.objects.get(pk=pk)
            # Check permissions
            user = request.user
            if not (transcription.image.document.project.owner == user or 
                   transcription.image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Create new transcription based on this one
            new_transcription = Transcription.objects.create(
                image=transcription.image,
                annotation=transcription.annotation,
                transcription_type=transcription.transcription_type,
                api_endpoint=transcription.api_endpoint,
                api_model=transcription.api_model,
                status='completed',
                text_content=transcription.text_content,
                confidence_score=transcription.confidence_score,
                api_response_raw=transcription.api_response_raw,
                processing_time=transcription.processing_time,
                parent_transcription=transcription,
                created_by=user
            )
            
            return Response(TranscriptionSerializer(new_transcription).data)
            
        except Transcription.DoesNotExist:
            return Response({'error': 'Transcription not found'}, status=status.HTTP_404_NOT_FOUND)


class ExportJobViewSet(viewsets.ModelViewSet):
    """CRUD operations for export jobs"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    serializer_class = ExportJobSerializer
    
    def get_queryset(self):
        return ExportJob.objects.filter(requested_by=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)


class ExportImageView(APIView):
    """Export single image data"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, image_id):
        export_format = request.data.get('format', 'json')
        
        try:
            image = Image.objects.get(pk=image_id)
            # Check permissions
            user = request.user
            if not (image.document.project.owner == user or 
                   image.document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Create export job
            export_job = ExportJob.objects.create(
                export_type='image',
                export_format=export_format,
                image=image,
                requested_by=user
            )
            
            # Process export
            export_service = ExportService()
            try:
                file_path = export_service.export_image(image, export_format)
                
                export_job.status = 'completed'
                export_job.file_path = file_path
                export_job.file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                export_job.completed_at = timezone.now()
                export_job.save()
                
            except Exception as e:
                export_job.status = 'failed'
                export_job.error_message = str(e)
                export_job.save()
                return Response(
                    {'error': f'Export failed: {str(e)}'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            return Response(ExportJobSerializer(export_job).data)
            
        except Image.DoesNotExist:
            return Response({'error': 'Image not found'}, status=status.HTTP_404_NOT_FOUND)


class ExportDocumentView(APIView):
    """Export document data"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, document_id):
        export_format = request.data.get('format', 'json')
        
        try:
            document = Document.objects.get(pk=document_id)
            # Check permissions
            user = request.user
            if not (document.project.owner == user or 
                   document.project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Create export job
            export_job = ExportJob.objects.create(
                export_type='document',
                export_format=export_format,
                document=document,
                requested_by=user
            )
            
            # Process export
            export_service = ExportService()
            try:
                file_path = export_service.export_document(document, export_format)
                
                export_job.status = 'completed'
                export_job.file_path = file_path
                export_job.file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                export_job.completed_at = timezone.now()
                export_job.save()
                
            except Exception as e:
                export_job.status = 'failed'
                export_job.error_message = str(e)
                export_job.save()
                return Response(
                    {'error': f'Export failed: {str(e)}'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            return Response(ExportJobSerializer(export_job).data)
            
        except Document.DoesNotExist:
            return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)


class ExportProjectView(APIView):
    """Export project data"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request, project_id):
        export_format = request.data.get('format', 'json')
        
        try:
            project = Project.objects.get(pk=project_id)
            # Check permissions
            user = request.user
            if not (project.owner == user or 
                   project.shared_with.filter(id=user.id).exists()):
                return Response(
                    {'error': 'Permission denied'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Create export job
            export_job = ExportJob.objects.create(
                export_type='project',
                export_format=export_format,
                project=project,
                requested_by=user
            )
            
            # Process export
            export_service = ExportService()
            try:
                file_path = export_service.export_project(project, export_format)
                
                export_job.status = 'completed'
                export_job.file_path = file_path
                export_job.file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                export_job.completed_at = timezone.now()
                export_job.save()
                
            except Exception as e:
                export_job.status = 'failed'
                export_job.error_message = str(e)
                export_job.save()
                return Response(
                    {'error': f'Export failed: {str(e)}'}, 
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            return Response(ExportJobSerializer(export_job).data)
            
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)


class DownloadExportView(APIView):
    """Download exported file"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request, job_id):
        try:
            export_job = ExportJob.objects.get(pk=job_id, requested_by=request.user)
            
            if export_job.status != 'completed' or not export_job.file_path:
                return Response(
                    {'error': 'Export not ready for download'}, 
                    status=status.HTTP_404_NOT_FOUND
                )
            
            if not os.path.exists(export_job.file_path):
                return Response(
                    {'error': 'Export file not found'}, 
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Determine content type
            content_type = 'application/octet-stream'
            if export_job.export_format == 'json':
                content_type = 'application/json'
            elif export_job.export_format == 'pagexml':
                content_type = 'application/xml'
            elif export_job.export_format == 'zip':
                content_type = 'application/zip'
            
            # Generate filename
            filename = f"{export_job.export_type}_{export_job.id}.{export_job.export_format}"
            
            with open(export_job.file_path, 'rb') as f:
                response = HttpResponse(f.read(), content_type=content_type)
                response['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response
                
        except ExportJob.DoesNotExist:
            return Response({'error': 'Export job not found'}, status=status.HTTP_404_NOT_FOUND)


class HealthCheckView(APIView):
    """Health check endpoint"""
    permission_classes = [AllowAny]
    
    def get(self, request):
        return Response({
            'status': 'healthy',
            'timestamp': timezone.now(),
            'version': '1.0.0'
        })


class UserStatsView(APIView):
    """Get user statistics"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def get(self, request):
        user = request.user
        
        stats = {
            'projects': user.owned_projects.count(),
            'shared_projects': user.shared_projects.count(),
            'documents': Document.objects.filter(project__owner=user).count(),
            'images': Image.objects.filter(document__project__owner=user).count(),
            'annotations': Annotation.objects.filter(
                image__document__project__owner=user, created_by=user
            ).count(),
            'transcriptions': Transcription.objects.filter(
                image__document__project__owner=user, created_by=user
            ).count(),
            'recent_activity': {
                'recent_projects': user.owned_projects.order_by('-updated_at')[:5].values(
                    'id', 'name', 'updated_at'
                ),
                'recent_transcriptions': Transcription.objects.filter(
                    image__document__project__owner=user
                ).order_by('-created_at')[:10].values(
                    'id', 'text_content', 'status', 'created_at'
                )
            }
        }
        
        return Response(stats)


class IIIFManifestView(APIView):
    """Create project/document from IIIF manifest"""
    permission_classes = [IsAuthenticated, IsApprovedUser]
    
    def post(self, request):
        manifest_url = request.data.get('manifest_url')
        max_width = request.data.get('max_width', '1000')
        
        if not manifest_url:
            return Response({'error': 'Manifest URL is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Fetch the IIIF manifest
            response = requests.get(manifest_url, timeout=30)
            response.raise_for_status()
            manifest = response.json()
            
            # Validate it's a IIIF manifest (support both 2.0 and 3.0)
            if '@context' not in manifest:
                return Response({'error': 'Invalid IIIF manifest - missing @context'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Check if it's IIIF 2.0 (has sequences) or 3.0 (has items directly)
            has_sequences = 'sequences' in manifest
            has_items = 'items' in manifest
            
            if not has_sequences and not has_items:
                return Response({'error': 'Invalid IIIF manifest - missing sequences or items'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Extract metadata
            title = manifest.get('label', 'IIIF Document')
            if isinstance(title, list):
                title = title[0] if title else 'IIIF Document'
            elif isinstance(title, dict):
                # Handle multi-language labels
                title = list(title.values())[0][0] if title else 'IIIF Document'
            
            description = manifest.get('description', '')
            if isinstance(description, list):
                description = description[0] if description else ''
            elif isinstance(description, dict):
                description = list(description.values())[0][0] if description else ''
            
            # Create project
            project = Project.objects.create(
                name=f"IIIF: {title}",
                description=f"Imported from IIIF manifest: {manifest_url}\n\n{description}",
                owner=request.user
            )
            
            # Create document
            document = Document.objects.create(
                name=title,
                description=description,
                project=project
            )
            
            # Process canvases to get images (support both IIIF 2.0 and 3.0)
            images_created = 0
            canvases = []
            
            if has_sequences:
                # IIIF 2.0 format
                for sequence in manifest.get('sequences', []):
                    canvases.extend(sequence.get('canvases', []))
            elif has_items:
                # IIIF 3.0 format
                canvases = manifest.get('items', [])
            
            for i, canvas in enumerate(canvases):
                # Extract label (handle different formats)
                canvas_label = self._extract_label(canvas.get('label', f'Page {i+1}'))
                
                # If label is empty or generic, try to get a better name
                if not canvas_label or canvas_label in ['Untitled', '']:
                    # Try to get image ID from canvas metadata
                    image_id = self._extract_image_id_from_canvas(canvas)
                    if image_id:
                        canvas_label = f"Image {image_id}"
                    else:
                        canvas_label = f"Page {i+1}"
                
                # Get the image URL from the canvas
                image_url = None
                
                if has_sequences:
                    # IIIF 2.0 format
                    if 'images' in canvas:
                        for img in canvas['images']:
                            if 'resource' in img:
                                resource = img['resource']
                                image_url = self._extract_image_url_from_resource(resource, max_width)
                                if image_url:
                                    break
                else:
                    # IIIF 3.0 format
                    if 'items' in canvas:
                        for annotation_page in canvas['items']:
                            if 'items' in annotation_page:
                                for annotation in annotation_page['items']:
                                    if 'body' in annotation:
                                        body = annotation['body']
                                        image_url = self._extract_image_url_from_resource(body, max_width)
                                        if image_url:
                                            break
                            if image_url:
                                break
                
                if not image_url:
                    continue
                
                try:
                    # Download and save the image
                    img_response = requests.get(image_url, timeout=60)
                    img_response.raise_for_status()
                    
                    # Create image record
                    image_content = ContentFile(img_response.content)
                    filename = f"{canvas_label.replace(' ', '_').replace('/', '_')}.jpg"
                    
                    # Get image dimensions
                    pil_image = PILImage.open(BytesIO(img_response.content))
                    width, height = pil_image.size
                    
                    image = Image.objects.create(
                        name=canvas_label,
                        document=document,
                        original_filename=filename,
                        width=width,
                        height=height,
                        file_size=len(img_response.content),
                        is_processed=True,
                        order=i
                    )
                    
                    # Save the image file
                    image.image_file.save(filename, image_content, save=True)
                    images_created += 1
                    
                except Exception as e:
                    print(f"Failed to download image {image_url}: {e}")
                    continue
            
            return Response({
                'message': 'IIIF manifest imported successfully',
                'project': ProjectDetailSerializer(project).data,
                'document': DocumentDetailSerializer(document).data,
                'images_created': images_created
            })
            
        except requests.RequestException as e:
            return Response({
                'error': f'Failed to fetch manifest: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({
                'error': f'Failed to process manifest: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _extract_label(self, label):
        """Extract string label from various IIIF label formats"""
        if isinstance(label, str):
            return label
        elif isinstance(label, list):
            return label[0] if label else 'Untitled'
        elif isinstance(label, dict):
            # Handle multi-language labels - try 'en' first, then 'none', then any key
            if 'en' in label:
                return label['en'][0] if isinstance(label['en'], list) else label['en']
            elif 'none' in label:
                return label['none'][0] if isinstance(label['none'], list) else label['none']
            else:
                # Take first available language
                for key, value in label.items():
                    return value[0] if isinstance(value, list) else value
        return 'Untitled'
    
    def _extract_image_id_from_canvas(self, canvas):
        """Extract image ID from canvas metadata"""
        if 'metadata' in canvas:
            for metadata_item in canvas['metadata']:
                if isinstance(metadata_item, dict):
                    label = metadata_item.get('label', {})
                    if isinstance(label, dict) and 'en' in label:
                        label_text = label['en'][0] if isinstance(label['en'], list) else label['en']
                        if 'Image ID' in label_text:
                            value = metadata_item.get('value', {})
                            if isinstance(value, dict) and 'none' in value:
                                return value['none'][0] if isinstance(value['none'], list) else value['none']
        return None
    
    def _extract_image_url_from_resource(self, resource, max_width='1000'):
        """Extract image URL from IIIF resource/body object"""
        if not resource:
            return None
            
        # Try to get from IIIF Image API service first (preferred for quality)
        if 'service' in resource:
            service = resource['service']
            if isinstance(service, list):
                service = service[0]
            if isinstance(service, dict) and '@id' in service:
                # Use IIIF Image API to get the requested size
                if max_width == 'full':
                    return f"{service['@id']}/full/full/0/default.jpg"
                else:
                    return f"{service['@id']}/full/{max_width},/0/default.jpg"
        
        # Fallback to direct image URL
        if 'id' in resource:
            return resource['id']
        elif '@id' in resource:
            return resource['@id']
            
        return None
