# NeoLeadge — Deployment Manager

> **AI Agent Context File** — This document contains essential information for AI coding agents working on this project.

## Project Overview

**NeoLeadge — Deployment Manager** (also referenced as `Integration.Elise`) is a full-stack web application for managing deployment projects. It serves as a custom action module integrated with the **Elise GED** (Electronic Document Management) system.

The application provides role-based project management with customizable templates, phase-gate validation workflows, and team collaboration features.

### Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Backend | .NET / ASP.NET Core | 8.0 |
| Database | SQL Server | - |
| ORM | Entity Framework Core | 8.0.12 |
| DI Container | Autofac | 9.1.0 |
| Frontend | Vue | 3.5.13 |
| Build Tool | Vite | 6.0.11 |
| State Management | Pinia | 3.0.4 |
| Language | TypeScript | ~5.7.3 |

## Project Structure

```
web/
├── Back/                           # .NET Backend
│   ├── Integration.Elise.Api.Template/    # ASP.NET Core Web API
│   │   ├── Controllers/            # API controllers
│   │   ├── Filters/                # Exception filters
│   │   ├── Middleware/             # Custom middleware
│   │   ├── Properties/             # Launch settings
│   │   ├── appsettings.json        # App configuration
│   │   └── Program.cs              # Entry point
│   └── Integration.Elise.Services/ # Business logic layer
│       ├── DI/                     # Autofac modules
│       ├── Impl/                   # Service implementations
│       ├── Infrastructure/         # DbContext, Migrations
│       ├── Interfaces/             # Service/repository interfaces
│       ├── Models/                 # Domain, DTOs, Enums
│       ├── Repositories/           # Data access
│       ├── Services/               # Business services
│       └── Validators/             # FluentValidation validators
├── Front/                          # Frontend applications
│   └── customapp/                  # Vue 3 + TypeScript app
│       ├── src/
│       │   ├── components/         # Vue components
│       │   ├── composables/        # Composition functions
│       │   ├── models/             # TypeScript interfaces
│       │   ├── router/             # Vue Router config
│       │   ├── stores/             # Pinia stores
│       │   ├── types/              # Type definitions
│       │   └── views/              # Page components
│       └── dist/                   # Build output
└── Packages/                       # Deployment packages
    ├── Build/Front/                # Copied frontend build
    ├── Config.json                 # Deployment configuration
    └── ExternalSourceMappingConfig.xml
```

## Backend Architecture

### Project Organization

The backend follows a layered architecture with clear separation of concerns:

1. **Integration.Elise.Api.Template** — Web API layer
   - Controllers handle HTTP requests
   - Filters for global exception handling
   - Middleware for request processing

2. **Integration.Elise.Services** — Business logic layer
   - Services contain business rules
   - Repositories handle data access
   - Models define domain entities and DTOs

### Key Dependencies

```xml
<!-- Core -->
<PackageReference Include="Autofac" Version="9.1.0" />
<PackageReference Include="Autofac.Extensions.DependencyInjection" Version="10.0.0" />
<PackageReference Include="AutoMapper" Version="14.0.0" />

<!-- Database -->
<PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.12" />
<PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.12" />

<!-- Security -->
<PackageReference Include="BCrypt.Net-Next" Version="4.0.3" />
<PackageReference Include="System.IdentityModel.Tokens.Jwt" Version="8.17.0" />

<!-- Validation -->
<PackageReference Include="FluentValidation" Version="11.11.0" />

<!-- Logging -->
<PackageReference Include="Serilog" Version="4.3.1" />
<PackageReference Include="Serilog.AspNetCore" Version="10.0.0" />

<!-- External Integration -->
<PackageReference Include="Integration.Elise.Web.Core" Version="2.0.50.1" />
```

### Database Context

The `ApplicationDbContext` defines these entities:

- **AppUsers** — Application users with roles
- **Projects** — Deployment projects
- **ProjectFields** — Custom field definitions
- **ProjectFieldValues** — Runtime field values
- **ProjectValidations** — Phase validation records
- **ProjectActivities** — Activity feed entries
- **ProjectTemplates** — Reusable project templates
- **ProjectTemplateFields** — Template field definitions

### Role-Based Access

Application roles (defined in `UserRole.cs`):

| Role | Description |
|------|-------------|
| `Admin` | Full system access |
| `ProjectManager` | Manage assigned projects |
| `SpecificationTeam` | Technical specification phase |
| `RealizationTeam` | Implementation phase |
| `DeploymentTeam` | Deployment phase |
| `Viewer` | Read-only access |

### Dependency Injection

Services are registered in `DI/ServiceModule.cs` using Autofac:

```csharp
// Repositories
builder.RegisterType<AppUserRepository>().As<IAppUserRepository>().InstancePerLifetimeScope();
builder.RegisterType<ProjectRepository>().As<IProjectRepository>().InstancePerLifetimeScope();

// Services  
builder.RegisterType<AppUserService>().As<IAppUserService>().InstancePerLifetimeScope();
builder.RegisterType<ProjectService>().As<IProjectService>().InstancePerLifetimeScope();
```

## Frontend Architecture

### Project Setup

The frontend is a Vue 3 application using the Composition API with TypeScript.

Key dependencies:

```json
{
  "vue": "^3.5.13",
  "vue-router": "^4.5.0",
  "pinia": "^3.0.4",
  "axios": "^1.7.9",
  "primevue": "^4.5.4",
  "vuetify": "^3.7.7",
  "@neolibrary/components": "file:../../../deign/components-0.2.123448.tgz"
}
```

### Application Structure

```
src/
├── components/           # Reusable components
│   ├── admin/           # Admin dashboard components
│   ├── pm/              # Project Manager components
│   └── icons/           # Icon components
├── composables/         # Shared logic
│   ├── useDarkMode.ts
│   ├── useProjectForm.ts
│   └── useUserManagement.ts
├── router/              # Routing configuration
├── stores/              # Pinia state stores
│   ├── useApp.ts        # Main app store (auth, API)
│   ├── projectStore.ts
│   ├── userStore.ts
│   └── pmStore.ts
├── types/               # TypeScript definitions
└── views/               # Page-level components
    ├── AdminView.vue
    ├── ProjectManagerView.vue
    ├── TeamMemberView.vue
    └── ...
```

### Routing

Routes are role-based:

| Route | View | Access |
|-------|------|--------|
| `/` | CustomActionView | All (via Elise) |
| `/admin` | AdminView | Admin |
| `/pm` | ProjectManagerView | ProjectManager |
| `/team` | TeamMemberView | Team roles |
| `/login` | LoginView | Public |
| `/unauthorized` | UnauthorizedView | Public |

### State Management

The main store (`useApp.ts`) manages:
- JWT authentication
- API URL configuration
- User role extraction from JWT
- Axios interceptors for 401 handling

## Build and Test Commands

### Backend (.NET)

```bash
# Navigate to backend
cd Back/Integration.Elise.Api.Template

# Build
dotnet build

# Run (Development)
dotnet run

# Database Migrations
dotnet ef migrations add <MigrationName> --project ../Integration.Elise.Services
dotnet ef database update

# Publish
dotnet publish -c Release
```

### Frontend (Vue)

```bash
# Navigate to frontend
cd Front/customapp

# Install dependencies
npm install

# Development server (http://localhost:5173)
npm run dev

# Production build
npm run build

# Type checking
npm run type-check

# Unit tests
npm run test:unit

# Linting
npm run lint

# Code formatting
npm run format

# Clean and reinstall
npm run clean
npm run reinstall
```

### Full Build Process

The backend's post-build script (`postbuild.bat`) automatically:
1. Builds the frontend (currently commented out)
2. Copies `dist/` to `Packages/Build/Front/`
3. Copies `web.config` from `Publish/` folder

## Configuration

### Backend (`appsettings.json`)

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=...;Database=...;Trusted_Connection=True;"
  },
  "CustomAction": {
    "Jwt": {
      "Key": "...",
      "Expires": 5,
      "Issuer": "...",
      "Audience": "..."
    },
    "APIKey": "..."
  },
  "EliseSoapService": {
    "Address": "https://.../EliseWebService.svc/SOAP",
    "Authentication": {
      "ApplicationID": "CustomActions",
      "ApplicationKey": "..."
    }
  }
}
```

### Frontend (`vite.config.ts`)

```typescript
export default defineConfig({
  server: { port: 5173 },
  base: '/Sample/Front/',  // Deployed path
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  }
})
```

## Development Conventions

### Code Style Guidelines

#### C# / .NET

- Use file-scoped namespaces
- Enable implicit usings
- Use nullable reference types (`<Nullable>enable</Nullable>`)
- XML documentation on public APIs
- Async suffix on async methods (`GetDataAsync`)

```csharp
/**
 * @file     FileName.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Description
 */
```

#### TypeScript / Vue

- Use Composition API with `<script setup>`
- Prefer `const` over `let`
- Use TypeScript interfaces for props
- Component names in PascalCase
- File names match component names

```typescript
// ESLint rules enforced:
'no-magic-numbers': [2, { ignore: [-1, 0, 1] }]
'@typescript-eslint/no-unused-vars': 2
'vue/no-unused-components': 2
'vue/no-mutating-props': 2
```

### Git Workflow

```bash
# Project uses standard Git workflow
# Protected branches: main
# Feature branches: feature/description
```

## Testing

### Backend Testing

- No explicit test project currently configured
- Consider adding xUnit for unit testing

### Frontend Testing

Uses **Vitest** with **jsdom** environment:

```bash
npm run test:unit
```

Test files: `src/components/__tests__/*.spec.ts`

## Security Considerations

### Authentication

- JWT-based authentication
- Tokens expire after 5 hours (configurable)
- Account lockout after 5 failed attempts (15-minute window)
- Role-based authorization on API endpoints

### CORS

Development CORS policy allows:
- `http://localhost:5173`
- `https://localhost:5173`

### Secrets Management

**NEVER commit actual secrets to git.**

Secrets are configured via:
- `appsettings.Development.json` (local dev)
- Environment variables (production)
- `Packages/Config.json` (deployment configuration template)

### Current Hardcoded Credentials (Development Only)

The `AuthController` contains hardcoded test users for development:

```csharp
["admin@neoleadge.com"]   = ("Admin@123",  "Admin", ...)
["pm@neoleadge.com"]      = ("Pm@123",     "ProjectManager", ...)
["valid@neoleadge.com"]   = ("Valid@123",  "DeploymentTeam", ...)
```

**TODO:** Replace with database-backed authentication before production.

## Deployment

### Build Output

- Backend: Standard .NET publish output
- Frontend: Copied to `Packages/Build/Front/`

### IIS Deployment

The `web.config` in `Front/customapp/Publish/` configures IIS for SPA hosting with URL rewrite rules.

### Elise Integration

The application integrates with Elise GED via:
- SOAP web services (`EliseSoapService`)
- Custom action URLs configured in `Packages/Config.json`
- GUID-based authentication flow from Elise

## Common Tasks

### Adding a New API Endpoint

1. Create DTOs in `Services/Models/DTOs/`
2. Add service method in `Services/Impl/`
3. Register in `DI/ServiceModule.cs`
4. Create controller action

### Adding a New Frontend Component

1. Create `.vue` file in `src/components/`
2. Export from parent or use directly in views
3. Add types to `src/types/` if needed
4. Add to store if shared state required

### Database Schema Changes

1. Update entity in `Models/Domain/`
2. Update `ApplicationDbContext.OnModelCreating()` if needed
3. Create migration:
   ```bash
   dotnet ef migrations add Description --project Integration.Elise.Services
   ```
4. Apply migration:
   ```bash
   dotnet ef database update
   ```

## Troubleshooting

### Frontend dev server not starting

```bash
cd Front/customapp
npm run reinstall  # Clean and reinstall
```

### Database connection issues

- Verify `appsettings.Development.json` connection string
- Ensure SQL Server is running
- Check firewall settings

### JWT authentication failures

- Verify JWT key configuration
- Check token expiration
- Ensure `Authorization: Bearer <token>` header is sent

## Design System — NeoLibrary

The project uses **NeoLibrary** (`@neolibrary/components` v0.2.0), a comprehensive Vue 3 component library built on PrimeVue 4 with custom Tailwind styling. Located at `../deign/components-0.2.123448.tgz`.

### Available Themes

| Theme | Description |
|-------|-------------|
| `neoledge` (default) | Custom Tailwind-styled theme with teal primary color (#0a6e89) |
| `aura` | Modern PrimeVue preset |
| `lara` | Classic PrimeVue preset |
| `nora` | Elegant PrimeVue preset |

### Setup in main.ts

```typescript
import { createApp } from 'vue'
import { NeoLibraryThemePlugin } from '@neolibrary/components'
import '@neolibrary/components/style.css'
import 'primeicons/primeicons.css'

const app = createApp(App)
app.use(NeoLibraryThemePlugin)  // Default: neoledge theme
app.mount('#app')
```

### Component Inventory (32 Components)

#### Form Input Fields (22)

| Component | Purpose |
|-----------|---------|
| `NeoInputText` | Text input with label, hint, error support |
| `NeoPassword` | Password with strength meter, toggle mask |
| `NeoTextarea` | Multi-line text input |
| `NeoInputIcon` | Input with left/right icons |
| `NeoInputNumber` | Numeric input with min/max |
| `NeoInputOtp` | OTP code input |
| `NeoDatePicker` | Date selection |
| `NeoTimePicker` | Time selection |
| `NeoSelect` | Single dropdown selection |
| `NeoMultiSelect` | Multiple selection dropdown |
| `NeoAutocomplete` | Search with suggestions |
| `NeoTreeSelect` | Hierarchical tree selection |
| `NeoCheckbox` | Boolean checkbox |
| `NeoRadioButton` | Radio button group |
| `NeoToggleSwitch` | On/off switch |
| `NeoToggleButton` | Stateful toggle button |
| `NeoRating` | Star rating input |
| `NeoChips` | Tags input |
| `NeoEditor` | Rich text editor (Quill-based) |
| `NeoField` | Base wrapper for consistent styling |
| `FormRenderer` | JSON-driven dynamic forms |

#### Media & Upload Components (5)

| Component | Purpose |
|-----------|---------|
| `NeoFileUpload` | Multi-file upload with drag-drop |
| `NeoQrCode` | QR code generation/reading |
| `NeoPhoto` | Camera capture |
| `NeoMap` | Interactive map (Leaflet) |
| `NeoSign` | Digital signature capture |

#### UI & Feedback Components (5)

| Component | Purpose |
|-----------|---------|
| `NeoButton` | Customizable buttons with severity variants |
| `NeoTag` | Category labels/badges |
| `NeoMessage` | Dismissible alert notifications |
| `NeoToast` | Toast notifications (requires `<NeoToast />` in App.vue) |
| `NeoConfirmDialog` | Modal confirmation dialogs |

### Severity Variants

Available for buttons, messages, tags:

| Severity | Color | Usage |
|----------|-------|-------|
| `primary` | Teal (#0a6e89) | Main actions |
| `secondary` | Gray | Neutral/default |
| `success` | Green | Positive feedback |
| `info` | Blue | Informational |
| `warn` | Amber | Warnings |
| `danger` | Red | Destructive actions |
| `contrast` | Dark | Maximum contrast |

### Common Props (All Form Components)

```typescript
{
  label?: string;           // Field label
  hint?: string;            // Helper text below field
  error?: string;           // Error message
  placeholder?: string;     // Placeholder text
  disabled?: boolean;       // Disable interaction
  readonly?: boolean;       // Read-only mode
  required?: boolean;       // Required indicator
  severity?: Severity;      // Visual style variant
  size?: 'small' | 'default' | 'large';
}
```

### Usage Examples

```vue
<template>
  <!-- Text input -->
  <NeoInputText
    v-model="name"
    label="Full Name"
    placeholder="Enter your name"
    hint="First and last name"
  />

  <!-- Password with strength -->
  <NeoPassword
    v-model="password"
    label="Password"
    :feedback="true"
    toggleMask
  />

  <!-- Select with options -->
  <NeoSelect
    v-model="country"
    label="Country"
    :options="countries"
    optionLabel="label"
    optionValue="value"
  />

  <!-- Button with severity -->
  <NeoButton label="Submit" severity="primary" />
  <NeoButton label="Delete" severity="danger" />

  <!-- Toast (add to App.vue root) -->
  <NeoToast />
</template>
```

### Composables

```vue
<script setup>
import { useNeoToast, useNeoConfirm } from '@neolibrary/components'

const toast = useNeoToast()
const confirm = useNeoConfirm()

// Toast notifications
const showSuccess = () => {
  toast.success('Operation completed!')
}

// Confirmation dialog
const handleDelete = async () => {
  const confirmed = await confirm.require({
    message: 'Are you sure?',
    header: 'Delete Confirmation',
    icon: 'pi pi-exclamation-triangle'
  })
  if (confirmed) {
    // Proceed with deletion
  }
}
</script>
```

### FormRenderer (Dynamic Forms)

```vue
<script setup>
const formSchema = {
  fields: [
    {
      name: 'email',
      type: 'inputtext',
      label: { en: 'Email', fr: 'E-mail' },
      validation: { required: true, email: true }
    },
    {
      name: 'age',
      type: 'inputnumber',
      label: { en: 'Age', fr: 'Âge' },
      validation: { required: true, min: 18 }
    },
    {
      name: 'country',
      type: 'select',
      label: { en: 'Country', fr: 'Pays' },
      options: [
        { label: 'France', value: 'FR' },
        { label: 'Germany', value: 'DE' }
      ]
    }
  ]
}
</script>

<template>
  <FormRenderer
    v-model="formData"
    :schema="formSchema"
    locale="en"
    @submit="handleSubmit"
  />
</template>
```

### Design System Guidelines

1. **Always use NeoLibrary components** instead of native HTML inputs or Vuetify for form elements
2. **Default to `neoledge` theme** — it's the brand theme with teal (#0a6e89) primary color
3. **Use severity consistently**:
   - `primary` for main actions
   - `danger` for destructive actions (delete, remove)
   - `success` for positive confirmations
   - `warn` for cautionary actions
4. **Include `<NeoToast />`** in App.vue for toast notifications to work
5. **Use FormRenderer** for dynamic forms instead of building forms manually
6. **Leverage composables** (`useNeoToast`, `useNeoConfirm`) for UX patterns

## Additional Resources

- [Vue 3 Docs](https://vuejs.org/guide/introduction.html)
- [Vite Config Reference](https://vitejs.dev/config/)
- [EF Core Migrations](https://docs.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
- [Autofac Documentation](https://autofac.readthedocs.io/)
- [NeoLibrary README](../deign/README%202.md) — Full component documentation
