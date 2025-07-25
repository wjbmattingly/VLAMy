from rest_framework import permissions


class IsApprovedUser(permissions.BasePermission):
    """
    Custom permission to only allow approved users to access the API.
    """
    message = "Your account is pending admin approval."
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Allow staff/admin users regardless of approval status
        if request.user.is_staff or request.user.is_superuser:
            return True
        
        # Check if user has a profile and is approved
        if hasattr(request.user, 'profile'):
            return request.user.profile.is_approved
        
        return False


class IsOwnerOrSharedUser(permissions.BasePermission):
    """
    Custom permission to only allow owners or users with shared access to view/edit objects.
    """
    
    def has_object_permission(self, request, view, obj):
        # Check different object types and their ownership/sharing rules
        
        # For Project objects
        if hasattr(obj, 'owner'):  # Project
            if obj.owner == request.user:
                return True
            # Check if user has shared access
            return obj.shared_with.filter(id=request.user.id).exists()
        
        # For Document objects
        elif hasattr(obj, 'project'):  # Document
            project = obj.project
            if project.owner == request.user:
                return True
            # Check if user has shared access
            return project.shared_with.filter(id=request.user.id).exists()
        
        # For Image objects (through document -> project)
        elif hasattr(obj, 'document'):  # Image
            project = obj.document.project
            if project.owner == request.user:
                return True
            # Check if user has shared access
            return project.shared_with.filter(id=request.user.id).exists()
        
        # For Annotation, Transcription objects (through image -> document -> project)
        elif hasattr(obj, 'image'):  # Annotation, Transcription
            project = obj.image.document.project
            if project.owner == request.user:
                return True
            # Check if user has shared access
            return project.shared_with.filter(id=request.user.id).exists()
        
        # For ExportJob objects
        elif hasattr(obj, 'requested_by'):  # ExportJob
            return obj.requested_by == request.user
        
        # Default to False if we can't determine ownership
        return False


class IsOwnerOrReadOnly(permissions.BasePermission):
    """
    Custom permission to only allow owners to edit, but allow shared users to read.
    """
    
    def has_object_permission(self, request, view, obj):
        # Read permissions for any authenticated user with access
        if request.method in permissions.SAFE_METHODS:
            return IsOwnerOrSharedUser().has_object_permission(request, view, obj)
        
        # Write permissions only for owners
        if hasattr(obj, 'owner'):  # Project
            return obj.owner == request.user
        elif hasattr(obj, 'project'):  # Document
            project = obj.project
            return project.owner == request.user
        elif hasattr(obj, 'document'):  # Image
            project = obj.document.project
            return project.owner == request.user
        elif hasattr(obj, 'image'):  # Annotation, Transcription
            project = obj.image.document.project
            return project.owner == request.user
        elif hasattr(obj, 'requested_by'):  # ExportJob
            return obj.requested_by == request.user
        
        return False


class CanEditProject(permissions.BasePermission):
    """
    Permission for users who can edit a project (owner or users with edit/admin permission).
    """
    
    def has_object_permission(self, request, view, obj):
        # Get the project from different object types
        if hasattr(obj, 'owner'):  # Project
            project = obj
        elif hasattr(obj, 'project'):  # Document
            project = obj.project
        elif hasattr(obj, 'document'):  # Image
            project = obj.document.project
        elif hasattr(obj, 'image'):  # Annotation, Transcription
            project = obj.image.document.project
        else:
            return False
        
        # Owner can always edit
        if project.owner == request.user:
            return True
        
        # Check for edit or admin permissions
        return project.projectpermission_set.filter(
            user=request.user,
            permission__in=['edit', 'admin']
        ).exists() 