from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from django.utils.html import format_html
from django.urls import reverse
from django.utils import timezone
from django.contrib import messages
from .models import (
    AccountRequest, UserProfile, Project, ProjectPermission, Document, 
    Image, Annotation, Transcription, ExportJob
)


@admin.register(AccountRequest)
class AccountRequestAdmin(admin.ModelAdmin):
    list_display = [
        'username', 'email', 'get_full_name', 'status', 'requested_at', 
        'reviewed_by', 'reviewed_at'
    ]
    list_filter = ['status', 'requested_at', 'reviewed_at']
    search_fields = ['username', 'email', 'first_name', 'last_name']
    readonly_fields = ['requested_at', 'password_hash']
    
    fieldsets = (
        ('Request Information', {
            'fields': ('username', 'email', 'first_name', 'last_name', 'request_reason', 'requested_at')
        }),
        ('Review Information', {
            'fields': ('status', 'reviewed_by', 'reviewed_at', 'admin_notes')
        }),
        ('Technical', {
            'fields': ('password_hash',),
            'classes': ('collapse',),
        }),
    )
    
    actions = ['approve_requests', 'deny_requests']
    
    def get_full_name(self, obj):
        return f"{obj.first_name} {obj.last_name}".strip() or '-'
    get_full_name.short_description = 'Full Name'
    
    def approve_requests(self, request, queryset):
        approved_count = 0
        error_count = 0
        
        for account_request in queryset.filter(status='pending'):
            try:
                # Check if username or email already exists
                if User.objects.filter(username=account_request.username).exists():
                    self.message_user(
                        request, 
                        f"Username '{account_request.username}' already exists. Skipped.",
                        level=messages.WARNING
                    )
                    continue
                
                if User.objects.filter(email=account_request.email).exists():
                    self.message_user(
                        request, 
                        f"Email '{account_request.email}' already exists. Skipped.",
                        level=messages.WARNING
                    )
                    continue
                
                # Create the user account
                user = User.objects.create_user(
                    username=account_request.username,
                    email=account_request.email,
                    first_name=account_request.first_name,
                    last_name=account_request.last_name,
                    password=None  # We'll set the password from the hash
                )
                
                # Set the pre-hashed password
                user.password = account_request.password_hash
                user.save()
                
                # Approve the user profile (created by signal)
                profile = user.profile
                profile.is_approved = True
                profile.approved_by = request.user
                profile.approved_at = timezone.now()
                profile.save()
                
                # Update the request
                account_request.status = 'approved'
                account_request.reviewed_by = request.user
                account_request.reviewed_at = timezone.now()
                account_request.save()
                
                approved_count += 1
                
            except Exception as e:
                error_count += 1
                self.message_user(
                    request, 
                    f"Error approving {account_request.username}: {str(e)}",
                    level=messages.ERROR
                )
        
        if approved_count > 0:
            self.message_user(
                request, 
                f'{approved_count} account request(s) approved successfully.',
                level=messages.SUCCESS
            )
        
        if error_count > 0:
            self.message_user(
                request, 
                f'{error_count} account request(s) failed to approve.',
                level=messages.ERROR
            )
    
    approve_requests.short_description = "Approve selected account requests"
    
    def deny_requests(self, request, queryset):
        updated = 0
        for account_request in queryset.filter(status='pending'):
            account_request.status = 'denied'
            account_request.reviewed_by = request.user
            account_request.reviewed_at = timezone.now()
            if not account_request.admin_notes:
                account_request.admin_notes = f"Denied by {request.user.username} via admin action"
            account_request.save()
            updated += 1
        
        if updated > 0:
            self.message_user(
                request, 
                f'{updated} account request(s) denied.',
                level=messages.SUCCESS
            )
    
    deny_requests.short_description = "Deny selected account requests"


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False
    verbose_name_plural = 'Profile'
    fk_name = 'user'
    fields = [
        'is_approved', 'approval_requested_at', 'approved_by', 'approved_at',
        'openai_api_key_set', 'custom_endpoint_url', 'custom_endpoint_set',
        'default_reading_order'
    ]
    readonly_fields = ['approval_requested_at']


class UserAdmin(BaseUserAdmin):
    inlines = (UserProfileInline,)
    list_display = [
        'username', 'email', 'first_name', 'last_name', 'is_staff', 
        'get_approval_status', 'get_approval_date'
    ]
    list_filter = BaseUserAdmin.list_filter + ('profile__is_approved',)
    
    def get_approval_status(self, obj):
        if hasattr(obj, 'profile'):
            if obj.profile.is_approved:
                return format_html('<span style="color: green;">✓ Approved</span>')
            else:
                return format_html('<span style="color: red;">✗ Pending</span>')
        return 'No Profile'
    get_approval_status.short_description = 'Approval Status'
    
    def get_approval_date(self, obj):
        if hasattr(obj, 'profile') and obj.profile.approved_at:
            return obj.profile.approved_at.strftime('%Y-%m-%d %H:%M')
        return '-'
    get_approval_date.short_description = 'Approved Date'


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'is_approved', 'approval_requested_at', 'approved_by', 
        'openai_api_key_set', 'custom_endpoint_set'
    ]
    list_filter = ['is_approved', 'approval_requested_at', 'openai_api_key_set']
    search_fields = ['user__username', 'user__email', 'user__first_name', 'user__last_name']
    readonly_fields = ['approval_requested_at']
    
    actions = ['approve_users', 'revoke_approval']
    
    def approve_users(self, request, queryset):
        updated = 0
        for profile in queryset.filter(is_approved=False):
            profile.is_approved = True
            profile.approved_by = request.user
            profile.approved_at = timezone.now()
            profile.save()
            updated += 1
        
        self.message_user(request, f'{updated} users approved successfully.')
    approve_users.short_description = "Approve selected users"
    
    def revoke_approval(self, request, queryset):
        updated = queryset.filter(is_approved=True).update(
            is_approved=False, 
            approved_by=None, 
            approved_at=None
        )
        self.message_user(request, f'{updated} users had approval revoked.')
    revoke_approval.short_description = "Revoke approval for selected users"


class ProjectPermissionInline(admin.TabularInline):
    model = ProjectPermission
    extra = 0
    fk_name = 'project'


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'owner', 'document_count', 'is_public', 'created_at', 'updated_at']
    list_filter = ['is_public', 'created_at', 'owner']
    search_fields = ['name', 'description', 'owner__username']
    readonly_fields = ['id', 'created_at', 'updated_at']
    inlines = [ProjectPermissionInline]
    
    def document_count(self, obj):
        return obj.documents.count()
    document_count.short_description = 'Documents'


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ['name', 'project', 'image_count', 'reading_order', 'created_at', 'updated_at']
    list_filter = ['reading_order', 'default_transcription_type', 'created_at', 'project__owner']
    search_fields = ['name', 'description', 'project__name']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    def image_count(self, obj):
        return obj.images.count()
    image_count.short_description = 'Images'


class AnnotationInline(admin.TabularInline):
    model = Annotation
    extra = 0
    readonly_fields = ['id', 'created_at']


class TranscriptionInline(admin.TabularInline):
    model = Transcription
    extra = 0
    readonly_fields = ['id', 'version', 'created_at']
    fields = ['transcription_type', 'api_endpoint', 'status', 'is_current', 'version']


@admin.register(Image)
class ImageAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'document', 'original_filename', 'file_size_kb', 
        'dimensions', 'annotation_count', 'transcription_count', 
        'is_processed', 'created_at'
    ]
    list_filter = ['is_processed', 'created_at', 'document__project__owner']
    search_fields = ['name', 'original_filename', 'document__name', 'document__project__name']
    readonly_fields = ['id', 'file_size', 'width', 'height', 'created_at', 'updated_at']
    inlines = [AnnotationInline, TranscriptionInline]
    
    def file_size_kb(self, obj):
        if obj.file_size:
            return f"{obj.file_size / 1024:.1f} KB"
        return '-'
    file_size_kb.short_description = 'File Size'
    
    def dimensions(self, obj):
        if obj.width and obj.height:
            return f"{obj.width} x {obj.height}"
        return '-'
    dimensions.short_description = 'Dimensions'
    
    def annotation_count(self, obj):
        return obj.annotations.count()
    annotation_count.short_description = 'Annotations'
    
    def transcription_count(self, obj):
        return obj.transcriptions.count()
    transcription_count.short_description = 'Transcriptions'


@admin.register(Annotation)
class AnnotationAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'image', 'annotation_type', 'label', 'reading_order', 
        'created_by', 'created_at'
    ]
    list_filter = ['annotation_type', 'created_at', 'created_by']
    search_fields = ['label', 'image__name', 'image__document__name']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(Transcription)
class TranscriptionAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'image', 'transcription_type', 'api_endpoint', 'status', 
        'version', 'is_current', 'confidence_score', 'created_by', 'created_at'
    ]
    list_filter = [
        'transcription_type', 'status', 'api_endpoint', 'is_current', 
        'created_at', 'created_by'
    ]
    search_fields = [
        'text_content', 'image__name', 'image__document__name',
        'api_endpoint', 'api_model'
    ]
    readonly_fields = [
        'id', 'version', 'api_response_raw', 'processing_time', 
        'created_at', 'updated_at'
    ]
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            'image', 'image__document', 'created_by'
        )


@admin.register(ExportJob)
class ExportJobAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'export_type', 'export_format', 'status', 'file_size_mb',
        'requested_by', 'created_at', 'completed_at'
    ]
    list_filter = ['export_type', 'export_format', 'status', 'created_at']
    search_fields = ['id', 'requested_by__username', 'file_path']
    readonly_fields = [
        'id', 'file_size', 'created_at', 'completed_at', 'file_path'
    ]
    
    def file_size_mb(self, obj):
        if obj.file_size:
            return f"{obj.file_size / (1024 * 1024):.1f} MB"
        return '-'
    file_size_mb.short_description = 'File Size'


# Re-register User admin with the profile inline
admin.site.unregister(User)
admin.site.register(User, UserAdmin)

# Customize admin site headers
admin.site.site_header = "VLAMy OCR Administration"
admin.site.site_title = "VLAMy OCR Admin"
admin.site.index_title = "OCR Application Management"
