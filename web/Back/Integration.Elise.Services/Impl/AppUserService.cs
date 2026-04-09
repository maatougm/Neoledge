/**
 * @file     AppUserService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Business logic for user management — password hashing, email uniqueness, soft-delete
 */

using AutoMapper;
using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Serilog;

namespace Integration.Elise.Services.Impl;

/// <inheritdoc cref="IAppUserService"/>
public class AppUserService : IAppUserService
{
    private readonly IAppUserRepository _repo;
    private readonly IMapper _mapper;
    private readonly ILogger _logger;
    private readonly ApplicationDbContext _db;

    public AppUserService(IAppUserRepository repo, IMapper mapper, ILogger logger, ApplicationDbContext db)
    {
        _repo = repo;
        _mapper = mapper;
        _logger = logger;
        _db = db;
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<UserResponseDto>>> GetAllUsersAsync(CancellationToken ct = default)
    {
        var users = await _repo.GetAllAsync(ct);
        _logger.Information("GetAllUsers — returned {Count} users", users.Count());
        return Result<IEnumerable<UserResponseDto>>.Ok(_mapper.Map<IEnumerable<UserResponseDto>>(users));
    }

    /// <inheritdoc/>
    public async Task<Result<UserResponseDto>> GetUserByIdAsync(Guid id, CancellationToken ct = default)
    {
        var user = await _repo.GetByIdAsync(id, ct);
        if (user is null)
        {
            _logger.Warning("GetUserById — user {Id} not found", id);
            return Result<UserResponseDto>.Fail($"Utilisateur {id} introuvable.");
        }
        return Result<UserResponseDto>.Ok(_mapper.Map<UserResponseDto>(user));
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<UserResponseDto>>> GetUsersByRoleAsync(UserRole role, CancellationToken ct = default)
    {
        var users = await _repo.GetByRoleAsync(role, ct);
        return Result<IEnumerable<UserResponseDto>>.Ok(_mapper.Map<IEnumerable<UserResponseDto>>(users));
    }

    /// <inheritdoc/>
    public async Task<Result<UserResponseDto>> CreateUserAsync(CreateUserDto dto, CancellationToken ct = default)
    {
        if (await _repo.ExistsAsync(dto.Email, ct))
        {
            _logger.Warning("CreateUser — email {Email} already exists", dto.Email);
            return Result<UserResponseDto>.Fail($"L'adresse e-mail '{dto.Email}' est déjà utilisée.");
        }

        var user = new AppUser
        {
            FirstName    = dto.FirstName,
            LastName     = dto.LastName,
            Email        = dto.Email.ToLower(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
            Role         = dto.Role
        };

        var created = await _repo.CreateAsync(user, ct);
        _logger.Information("CreateUser — created user {Id} ({Email})", created.Id, created.Email);
        return Result<UserResponseDto>.Ok(_mapper.Map<UserResponseDto>(created));
    }

    /// <inheritdoc/>
    public async Task<Result<UserResponseDto>> UpdateUserAsync(Guid id, UpdateUserDto dto, CancellationToken ct = default)
    {
        var user = await _repo.GetByIdAsync(id, ct);
        if (user is null)
        {
            _logger.Warning("UpdateUser — user {Id} not found", id);
            return Result<UserResponseDto>.Fail($"Utilisateur {id} introuvable.");
        }

        if (dto.Email is not null && !dto.Email.Equals(user.Email, StringComparison.OrdinalIgnoreCase))
        {
            if (await _repo.ExistsAsync(dto.Email, ct))
                return Result<UserResponseDto>.Fail($"L'adresse e-mail '{dto.Email}' est déjà utilisée.");
            user.Email = dto.Email.ToLower();
        }

        if (dto.FirstName is not null) user.FirstName = dto.FirstName;
        if (dto.LastName  is not null) user.LastName  = dto.LastName;
        if (dto.Role      is not null) user.Role      = dto.Role.Value;

        await _repo.UpdateAsync(user, ct);
        _logger.Information("UpdateUser — updated user {Id}", id);
        return Result<UserResponseDto>.Ok(_mapper.Map<UserResponseDto>(user));
    }

    /// <inheritdoc/>
    public async Task<Result<string>> ResetPasswordAsync(Guid id, CancellationToken ct = default)
    {
        var user = await _repo.GetByIdAsync(id, ct);
        if (user is null)
        {
            _logger.Warning("ResetPassword — user {Id} not found", id);
            return Result<string>.Fail($"Utilisateur {id} introuvable.");
        }

        var tempPassword = GenerateTemporaryPassword();
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
        await _repo.UpdateAsync(user, ct);

        _logger.Information("ResetPassword — reset password for user {Id}", id);
        return Result<string>.Ok(tempPassword);
    }

    /// <inheritdoc/>
    public async Task<Result> DeactivateAsync(Guid id, Guid requestingUserId, CancellationToken ct = default)
    {
        if (id == requestingUserId)
            return Result.Fail("Vous ne pouvez pas désactiver votre propre compte.");

        var user = await _repo.GetByIdAsync(id, ct);
        if (user is null)
        {
            _logger.Warning("Deactivate — user {Id} not found", id);
            return Result.Fail($"Utilisateur {id} introuvable.");
        }

        await _repo.SoftDeleteAsync(id, ct);
        _logger.Information("Deactivate — deactivated user {Id}", id);
        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> ReactivateAsync(Guid id, CancellationToken ct = default)
    {
        var user = await _repo.GetByIdAsync(id, ct);
        if (user is null)
        {
            _logger.Warning("Reactivate — user {Id} not found", id);
            return Result.Fail($"Utilisateur {id} introuvable.");
        }

        user.IsActive = true;
        await _repo.UpdateAsync(user, ct);
        _logger.Information("Reactivate — reactivated user {Id}", id);
        return Result.Ok();
    }

    // ── Pagination ───────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<Result<PaginatedResult<UserResponseDto>>> GetUsersPagedAsync(
        int skip, int take, string? search, string? role, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 100);
        if (skip < 0) skip = 0;

        var query = _db.AppUsers.AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.ToLower();
            query = query.Where(u =>
                u.FirstName.ToLower().Contains(term) ||
                u.LastName.ToLower().Contains(term) ||
                u.Email.ToLower().Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(role)
            && Enum.TryParse<UserRole>(role, ignoreCase: true, out var parsedRole))
        {
            query = query.Where(u => u.Role == parsedRole);
        }

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderBy(u => u.LastName)
            .ThenBy(u => u.FirstName)
            .Skip(skip)
            .Take(take)
            .ToListAsync(ct);

        var dtos = _mapper.Map<List<UserResponseDto>>(items);

        return Result<PaginatedResult<UserResponseDto>>.Ok(
            new PaginatedResult<UserResponseDto>(dtos, total, skip, take));
    }

    private static string GenerateTemporaryPassword()
    {
        const string chars = "ABCDEFGHJKMNPQRSTWXYZabcdefghjkmnpqrstwxyz23456789!@#$";
        var rng = new Random();
        return new string(Enumerable.Range(0, 12).Select(_ => chars[rng.Next(chars.Length)]).ToArray());
    }
}
