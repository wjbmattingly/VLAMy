from django.urls import path, include
from rest_framework.routers import DefaultRouter

from . import views

# Create router for ViewSets
router = DefaultRouter()
router.register(r'projects', views.ProjectViewSet, basename='project')
router.register(r'documents', views.DocumentViewSet, basename='document')
router.register(r'images', views.ImageViewSet, basename='image')
router.register(r'annotations', views.AnnotationViewSet, basename='annotation')
router.register(r'transcriptions', views.TranscriptionViewSet, basename='transcription')
router.register(r'export-jobs', views.ExportJobViewSet, basename='exportjob')

app_name = 'ocr_app'

urlpatterns = [
    # Authentication endpoints
    path('auth/register/', views.UserRegistrationView.as_view(), name='register'),
    path('auth/login/', views.CustomLoginView.as_view(), name='login'),
    path('auth/profile/', views.UserProfileView.as_view(), name='profile'),
    path('auth/credentials/', views.APICredentialsView.as_view(), name='api_credentials'),
    
    # User management
    path('users/search/', views.UserSearchView.as_view(), name='user_search'),
    
    # Annotation types
    path('annotation-types/', views.AnnotationTypesView.as_view(), name='annotation_types'),
    
    # Project permissions
    path('projects/<uuid:pk>/permissions/', views.ProjectPermissionView.as_view(), name='project_permissions'),
    path('projects/<uuid:pk>/share/', views.ShareProjectView.as_view(), name='share_project'),
    
    # Image-specific actions
    path('images/<uuid:pk>/upload/', views.ImageUploadView.as_view(), name='image_upload'),
    path('images/<uuid:pk>/transcribe/', views.TranscribeImageView.as_view(), name='transcribe_image'),
    path('images/<uuid:pk>/annotations/', views.ImageAnnotationsView.as_view(), name='image_annotations'),
    path('images/<uuid:pk>/annotations/reorder/', views.ReorderAnnotationsView.as_view(), name='reorder_annotations'),
    
    # Annotation transcription
    path('annotations/<uuid:pk>/transcribe/', views.TranscribeAnnotationView.as_view(), name='transcribe_annotation'),
    
    # Transcription management
    path('transcriptions/<uuid:pk>/revert/', views.RevertTranscriptionView.as_view(), name='revert_transcription'),
    
    # Export endpoints
    path('export/image/<uuid:image_id>/', views.ExportImageView.as_view(), name='export_image'),
    path('export/document/<uuid:document_id>/', views.ExportDocumentView.as_view(), name='export_document'),
    path('export/project/<uuid:project_id>/', views.ExportProjectView.as_view(), name='export_project'),
    path('export/download/<uuid:job_id>/', views.DownloadExportView.as_view(), name='download_export'),
    
    # Utility endpoints
    path('health/', views.HealthCheckView.as_view(), name='health'),
    path('stats/', views.UserStatsView.as_view(), name='user_stats'),
    
    # IIIF manifest import
    path('iiif/import/', views.IIIFManifestView.as_view(), name='iiif_import'),
    
    # Include router URLs
    path('', include(router.urls)),
] 