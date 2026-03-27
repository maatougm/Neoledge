/**
 * @file     AuthService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Validates email + BCrypt password; returns user DTO for JWT claim assembly
 */

using AutoMapper;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using Serilog;

namespace Integration.Elise.Services.Impl;

/// <inheritdoc cref="IAuthService"/>
public class AuthService : IAuthService
{
    private readonly IAppUserRepository _repo;
    private readonly IMapper _mapper;
    private readonly ILogger _logger;

    public AuthService(IAppUserRepository repo, IMapper mapper, ILogger logger)
    {
        _repo   = repo;
        _mapper = mapper;
        _logger = logger;
    }

    /// <inheritdoc/>
    public async Task<Result<UserResponseDto>> ValidateCredentialsAsync(
        string email,
        string password,
        CancellationToken ct = default)
    {
        var user = await _repo.GetByEmailAsync(email, ct);

        if (user is null || !user.IsActive)
        {
            _logger.Warning("Login failed — email {Email} not found or inactive", email);
            return Result<UserResponseDto>.Fail("Email ou mot de passe incorrect.");
        }

        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        {
            _logger.Warning("Login failed — wrong password for {Email}", email);
            return Result<UserResponseDto>.Fail("Email ou mot de passe incorrect.");
        }

        _logger.Information("Login success — user {Id} ({Email})", user.Id, user.Email);
        return Result<UserResponseDto>.Ok(_mapper.Map<UserResponseDto>(user));
    }
}
