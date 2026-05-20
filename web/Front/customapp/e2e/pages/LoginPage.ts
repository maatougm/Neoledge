import { expect, type Page, type Locator } from '@playwright/test'

/**
 * Page object for the `/login` view. NeoLibrary inputs are rendered via the
 * `label` prop — we locate by the `label` text rather than CSS class so the
 * tests survive style refactors.
 */
export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorBanner: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.getByLabel(/Adresse e-mail/i)
    this.passwordInput = page.getByLabel(/Mot de passe/i)
    this.submitButton = page.getByRole('button', { name: /Se connecter/i })
    // The error surface is a NeoToast; fall back to any visible "incorrect"
    // / "erreur" string near the form.
    this.errorBanner = page
      .locator('[role="alert"], .p-toast-detail, .form-error')
      .filter({ hasText: /incorrect|erreur|invalide/i })
      .first()
  }

  async goto(): Promise<void> {
    await this.page.goto('/login')
    await expect(this.emailInput).toBeVisible()
  }

  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
  }

  /** Submit + wait for the post-login destination. Different roles land on
   *  different routes, so we accept any of the known landing paths. */
  async submitAndExpectDashboard(): Promise<void> {
    await this.submitButton.click()
    await this.page.waitForURL(
      /\/app\/(admin|pm|member|specification)?/,
      { timeout: 20_000 },
    )
  }

  async submitAndExpectError(): Promise<void> {
    await this.submitButton.click()
    await expect(this.errorBanner).toBeVisible({ timeout: 10_000 })
  }
}
