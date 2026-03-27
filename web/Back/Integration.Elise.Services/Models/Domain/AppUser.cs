/**
 * @file     AppUser.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Application user entity — persisted in AppUsers table
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.Domain;

/// <summary>Represents an authenticated user of the deployment management module.</summary>
public class AppUser
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>User's first name.</summary>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>User's last name.</summary>
    public string LastName { get; set; } = string.Empty;

    /// <summary>Unique email address — used as login identifier.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>BCrypt-hashed password.</summary>
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>Assigned role controlling access rights.</summary>
    public UserRole Role { get; set; } = UserRole.Viewer;

    /// <summary>Whether the account is active. Soft-delete via deactivation.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>UTC date/time the account was created.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>UTC date/time of the most recent successful login. Null until first login.</summary>
    public DateTime? LastLoginAt { get; set; }

    /// <summary>Forces the user to change their password on next login (e.g. after a temp password reset).</summary>
    public bool MustChangePassword { get; set; } = false;

    /// <summary>Number of consecutive failed login attempts. Reset to 0 on successful login.</summary>
    public int FailedLoginAttempts { get; set; } = 0;

    /// <summary>UTC date/time until which the account is locked due to repeated failed logins. Null when not locked.</summary>
    public DateTime? LockedUntil { get; set; }

    // ── Profile Fields ──────────────────────────────────────────────────────
    /// <summary>Path to user's avatar/profile picture.</summary>
    public string? AvatarPath { get; set; }

    /// <summary>User's job title.</summary>
    public string? JobTitle { get; set; }

    /// <summary>User's phone number.</summary>
    public string? PhoneNumber { get; set; }

    /// <summary>User's department/team.</summary>
    public string? Department { get; set; }

    /// <summary>User preferences (JSON).</summary>
    public string? Preferences { get; set; }

    // Navigation properties
    /// <summary>Projects managed by this user (when role = ProjectManager).</summary>
    public ICollection<Project> ManagedProjects { get; set; } = new List<Project>();

    /// <summary>Comments made by this user.</summary>
    public ICollection<ProjectComment> Comments { get; set; } = new List<ProjectComment>();

    /// <summary>Attachments uploaded by this user.</summary>
    public ICollection<ProjectAttachment> Attachments { get; set; } = new List<ProjectAttachment>();
}
