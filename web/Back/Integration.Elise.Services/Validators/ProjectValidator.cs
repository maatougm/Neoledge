/**
 * @file     ProjectValidator.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     FluentValidation rules for CreateProjectDto and UpdateProjectDto
 */

using FluentValidation;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Validators;

/// <summary>Validation rules for <see cref="CreateProjectDto"/>.</summary>
public class CreateProjectValidator : AbstractValidator<CreateProjectDto>
{
    public CreateProjectValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Le nom du projet est requis.")
            .MaximumLength(200).WithMessage("Le nom ne peut pas dépasser 200 caractères.");

        RuleFor(x => x.ClientName)
            .NotEmpty().WithMessage("Le nom du client est requis.")
            .MaximumLength(200).WithMessage("Le nom du client ne peut pas dépasser 200 caractères.");

        RuleFor(x => x.StartDate)
            .NotEmpty().WithMessage("La date de début est requise.")
            .GreaterThanOrEqualTo(DateTime.UtcNow.Date)
            .WithMessage("La date de début ne peut pas être dans le passé.");

        RuleFor(x => x.EndDate)
            .NotEmpty().WithMessage("La date de fin est requise.")
            .GreaterThan(x => x.StartDate)
            .WithMessage("La date de fin doit être postérieure à la date de début.");
    }
}

/// <summary>Validation rules for <see cref="UpdateProjectDto"/>.</summary>
public class UpdateProjectValidator : AbstractValidator<UpdateProjectDto>
{
    public UpdateProjectValidator()
    {
        When(x => x.Name is not null, () =>
            RuleFor(x => x.Name)
                .NotEmpty().WithMessage("Le nom du projet ne peut pas être vide.")
                .MaximumLength(200).WithMessage("Le nom ne peut pas dépasser 200 caractères."));

        When(x => x.ClientName is not null, () =>
            RuleFor(x => x.ClientName)
                .NotEmpty().WithMessage("Le nom du client ne peut pas être vide.")
                .MaximumLength(200).WithMessage("Le nom du client ne peut pas dépasser 200 caractères."));

        When(x => x.StartDate is not null && x.EndDate is not null, () =>
            RuleFor(x => x.EndDate)
                .GreaterThan(x => x.StartDate)
                .WithMessage("La date de fin doit être postérieure à la date de début."));
    }
}
