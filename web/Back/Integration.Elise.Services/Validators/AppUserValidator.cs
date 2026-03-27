/**
 * @file     AppUserValidator.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     FluentValidation rules for CreateUserDto and UpdateUserDto
 */

using FluentValidation;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Validators;

/// <summary>Validation rules for <see cref="CreateUserDto"/>.</summary>
public class CreateUserValidator : AbstractValidator<CreateUserDto>
{
    public CreateUserValidator()
    {
        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("Le prénom est requis.")
            .MaximumLength(100).WithMessage("Le prénom ne peut pas dépasser 100 caractères.");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Le nom est requis.")
            .MaximumLength(100).WithMessage("Le nom ne peut pas dépasser 100 caractères.");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'adresse e-mail est requise.")
            .EmailAddress().WithMessage("L'adresse e-mail est invalide.")
            .MaximumLength(256).WithMessage("L'adresse e-mail ne peut pas dépasser 256 caractères.");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Le mot de passe est requis.")
            .MinimumLength(8).WithMessage("Le mot de passe doit comporter au moins 8 caractères.")
            .Matches("[A-Z]").WithMessage("Le mot de passe doit contenir au moins une lettre majuscule.")
            .Matches("[0-9]").WithMessage("Le mot de passe doit contenir au moins un chiffre.");

        RuleFor(x => x.Role)
            .IsInEnum().WithMessage("Le rôle spécifié est invalide.");
    }
}

/// <summary>Validation rules for <see cref="UpdateUserDto"/>.</summary>
public class UpdateUserValidator : AbstractValidator<UpdateUserDto>
{
    public UpdateUserValidator()
    {
        When(x => x.FirstName is not null, () =>
            RuleFor(x => x.FirstName)
                .MaximumLength(100).WithMessage("Le prénom ne peut pas dépasser 100 caractères."));

        When(x => x.LastName is not null, () =>
            RuleFor(x => x.LastName)
                .MaximumLength(100).WithMessage("Le nom ne peut pas dépasser 100 caractères."));

        When(x => x.Email is not null, () =>
            RuleFor(x => x.Email)
                .EmailAddress().WithMessage("L'adresse e-mail est invalide.")
                .MaximumLength(256).WithMessage("L'adresse e-mail ne peut pas dépasser 256 caractères."));

        When(x => x.Role is not null, () =>
            RuleFor(x => x.Role)
                .IsInEnum().WithMessage("Le rôle spécifié est invalide."));
    }
}
