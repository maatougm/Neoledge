/**
 * @file     Result.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Generic Result<T> pattern for typed success/error returns without exceptions
 */

namespace Integration.Elise.Services.Models;

/// <summary>
/// Represents the outcome of an operation, carrying either a value or an error message.
/// </summary>
/// <typeparam name="T">Type of the success value.</typeparam>
public sealed class Result<T>
{
    private Result(T? value, string? error)
    {
        Value = value;
        Error = error;
        IsSuccess = error is null;
    }

    /// <summary>Whether the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>Whether the operation failed.</summary>
    public bool IsFailure => !IsSuccess;

    /// <summary>The success value — null when <see cref="IsSuccess"/> is false.</summary>
    public T? Value { get; }

    /// <summary>The error message — null when <see cref="IsSuccess"/> is true.</summary>
    public string? Error { get; }

    /// <summary>Creates a successful result wrapping the given value.</summary>
    public static Result<T> Ok(T value) => new(value, null);

    /// <summary>Creates a failure result with the given error message.</summary>
    public static Result<T> Fail(string error) => new(default, error);
}

/// <summary>
/// Non-generic result for void operations.
/// </summary>
public sealed class Result
{
    private Result(bool isSuccess, string? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Whether the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>Whether the operation failed.</summary>
    public bool IsFailure => !IsSuccess;

    /// <summary>The error message — null when <see cref="IsSuccess"/> is true.</summary>
    public string? Error { get; }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failure result with the given error message.</summary>
    public static Result Fail(string error) => new(false, error);
}
