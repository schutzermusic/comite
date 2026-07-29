# Prompt Sênior — Redesign UI/UX do Ponto Insight Apex para Opus 5

You are a Senior Product Designer, UX Architect, and Frontend Engineer specialized in workforce management, attendance systems, mobile-first SaaS products, geolocation, and field operations.

Your task is to redesign the UI/UX of the employee attendance application:

**https://ponto.insightapex.co**

The application is part of the Insight Apex ecosystem and must feel like a native extension of the main Insight Apex platform, not a separate or generic HR application.

Use the attached mobile attendance application image as a visual reference for:

- Mobile-first composition
- Clear attendance action
- Large clock-in/clock-out control
- Facial verification flow
- Attendance history
- Lightweight cards
- Simple navigation
- Clean hierarchy
- Premium employee experience

Do not copy the reference literally. Adapt its strongest UX principles to the Insight Apex design system and operational context.

---

## 1. PRIMARY OBJECTIVE

Redesign the attendance experience so field employees can quickly and safely:

- Clock in
- Clock out
- Start and finish breaks
- Verify their current geolocation
- Confirm whether they are inside the authorized worksite geofence
- Capture a selfie when required
- View their current workday status
- View attendance records
- View pending or rejected attendance events
- Submit attendance adjustment requests
- Understand permission, connectivity, GPS, and synchronization problems
- Access the essential features with minimal cognitive effort

The most important action must always be obvious:

**“Bater ponto”**

The user should be able to complete a valid attendance registration in approximately 5 to 10 seconds when permissions are already granted.

---

## 2. INSIGHT APEX VISUAL INTEGRATION

Before redesigning the interface, inspect the existing Insight Apex application and identify its current:

- Design tokens
- Brand colors
- Typography
- Border radii
- Shadows
- Card patterns
- Icons
- Buttons
- Navigation patterns
- Status badges
- Spacing scale
- Light and dark mode behavior

Reuse the existing Insight Apex design language wherever possible.

Do not create an unrelated standalone design system.

The Ponto application should feel:

- Premium
- Operational
- Trustworthy
- Modern
- Clean
- Fast
- Human
- Suitable for field employees
- Consistent with an enterprise SaaS platform

Avoid:

- Generic AI-generated dashboard appearance
- Excessive gradients
- Excessive glassmorphism
- Decorative elements without functional purpose
- Too many cards competing for attention
- Tiny text
- Excessive analytics on the employee homepage
- Desktop-style tables compressed into mobile screens
- Overuse of green
- Oversized empty spaces
- Excessive animations
- Visual noise

Use the primary Insight Apex brand accent for important actions and attendance states. Use colors semantically and consistently.

---

## 3. MOBILE-FIRST EXPERIENCE

The application must be designed primarily for smartphones because most attendance registrations will occur in the field.

Target widths:

- 320px
- 375px
- 390px
- 430px
- Tablet
- Responsive desktop

Respect:

- iOS safe areas
- Android browser chrome
- PWA standalone mode
- Dynamic viewport height
- Touch targets of at least 44px
- One-handed usage
- Outdoor readability
- Low-quality mobile connections
- Older or mid-range Android devices

The interface must remain usable under strong sunlight and unstable internet conditions.

---

## 4. EMPLOYEE HOME SCREEN

Create a focused home screen with the following hierarchy:

### Header

- Insight Apex / Ponto branding
- Employee name
- Employee photo or avatar
- Current date
- Notification indicator
- Optional worksite or project name

### Main attendance card

- Current time in real time
- Current workday status
- Main attendance action
- Geolocation status
- Worksite/geofence status
- Last synchronization status
- Short contextual instruction

Possible main statuses:

- Jornada não iniciada
- Entrada registrada
- Em intervalo
- Retorno do intervalo registrado
- Jornada em andamento
- Saída registrada
- Registro pendente de sincronização
- Registro em análise
- Fora da área autorizada
- Localização indisponível

The main button must dynamically change according to the employee’s current state:

- Registrar entrada
- Iniciar intervalo
- Encerrar intervalo
- Registrar saída
- Tentar novamente
- Sincronizar registro

Do not show impossible actions.

Example:

After clock-in, the user should not continue seeing “Registrar entrada”.

### Secondary daily summary

- Entrada
- Início do intervalo
- Fim do intervalo
- Saída
- Total trabalhado
- Total de intervalo

Keep this compact and readable.

### Secondary content

- Recent attendance activity
- Pending issues requiring employee attention
- Adjustment request status
- Upcoming schedule or worksite assignment, only when useful

Do not turn the employee homepage into an administrative dashboard.

---

## 5. MAIN ATTENDANCE ACTION

The clock-in interaction should be visually dominant, inspired by the central circular action from the reference image, but adapted to Insight Apex.

Create a premium attendance action component with:

- Large touch area
- Clear action label
- Relevant icon
- Current action status
- Subtle visual feedback
- Loading state
- Success state
- Error state
- Disabled state
- Offline state

The component may be circular or rounded, but it must remain consistent with the Insight Apex visual system.

Do not use a decorative floating button without sufficient context.

Before confirming attendance, clearly communicate:

- GPS status
- Distance from the authorized worksite
- Whether the employee is inside or outside the geofence
- Accuracy of the current position when available
- Whether selfie verification is required
- Whether internet connectivity is available

Examples:

> Você está a 32 m da área autorizada.

> Não foi possível confirmar sua localização. Ative o GPS para continuar.

---

## 6. GEOLOCATION AND GEOFENCE UX

Create explicit and understandable geolocation states.

Required states:

1. Requesting location permission
2. Permission granted
3. Permission denied
4. Permission permanently blocked
5. GPS disabled
6. Location loading
7. Low accuracy
8. Inside authorized geofence
9. Outside authorized geofence
10. No worksite assigned
11. Geofence validation unavailable
12. Offline but location captured locally
13. Suspected mock location, when supported by the existing system

Do not use technical error messages as the primary interface.

Bad:

> GeolocationPositionError code 1

Good:

> O acesso à localização foi bloqueado. Abra as configurações do navegador e permita o uso da localização para registrar o ponto.

Provide actionable recovery instructions.

Where useful, add a compact expandable location panel containing:

- Worksite name
- Project name
- Current distance
- Permitted radius
- GPS accuracy
- Last update time
- Small map preview, only if it improves comprehension

Do not make the employee interact with a full map just to register attendance.

---

## 7. SELFIE AND FACIAL VERIFICATION

Redesign the selfie verification step using the attached reference as inspiration.

The camera experience must include:

- Large camera preview
- Clear facial alignment guide
- Simple instruction
- Camera permission state
- Front-camera selection
- Flash control only if supported and relevant
- Retake option
- Confirmation state
- Uploading state
- Validation state
- Failure state
- Offline capture state, if supported

Use neutral, respectful language.

Example instructions:

- “Posicione seu rosto dentro da área indicada.”
- “Mantenha o celular na altura dos olhos.”
- “Evite ambientes muito escuros.”
- “Foto registrada com sucesso.”

Do not display a fake facial scan animation if no real facial recognition process exists.

If the current application only stores a selfie for verification, describe it as selfie confirmation, not biometric facial recognition.

Preserve all existing privacy, audit, signed URL, retention, and access-control logic.

---

## 8. ATTENDANCE CONFIRMATION

After a successful registration, show a clear confirmation screen or bottom sheet containing:

- Action registered
- Exact date and time
- Worksite
- Project
- Location validation
- Selfie confirmation, when applicable
- Synchronization status
- Attendance record identifier, if useful

Example:

> Entrada registrada com sucesso

> 29 de julho de 2026, às 08:25

> Local: Subestação Londrina

> Dentro da área autorizada

Use a subtle success animation through Motion, Framer Motion, or the animation library already adopted by Insight Apex.

The animation should last approximately 200–400 ms and must not delay the workflow.

---

## 9. ATTENDANCE HISTORY

Redesign the attendance history for mobile.

Avoid traditional wide tables on smartphones.

Use daily timeline cards containing:

- Date
- Clock-in
- Break start
- Break end
- Clock-out
- Total worked
- Status
- Worksite
- Adjustment indicator
- Synchronization status

Allow filtering by:

- Current month
- Custom period
- Status
- Worksite or project, when relevant

Possible status badges:

- Completo
- Incompleto
- Em análise
- Ajustado
- Rejeitado
- Pendente de sincronização
- Ausência
- Folga
- Feriado

Use a chronological visual timeline inside the day details.

Desktop may use a structured table, but mobile must use cards or a timeline.

---

## 10. ATTENDANCE ADJUSTMENTS

Create a simple attendance adjustment flow.

The employee should be able to:

- Select the affected date
- Select the missing or incorrect event
- Enter the correct time
- Choose a reason
- Add a short explanation
- Attach evidence, when enabled
- Submit the request
- Track approval status

Statuses:

- Rascunho
- Enviado
- Em análise
- Aprovado
- Rejeitado
- Correção solicitada

Show the manager’s reason when a request is rejected.

Do not expose internal administrative terminology to employees.

---

## 11. NAVIGATION

Create a compact mobile bottom navigation with no more than five primary destinations.

Recommended structure:

1. Início
2. Histórico
3. Bater ponto
4. Solicitações
5. Perfil

The attendance action may be emphasized in the center, but it must not look disconnected from the navigation.

For desktop or tablet, adapt the navigation to the existing Insight Apex application shell.

Use consistent labels and icons.

Do not use icon-only navigation for essential destinations without labels.

---

## 12. OFFLINE AND SYNCHRONIZATION

The interface must clearly support field operation with unstable internet.

Design states for:

- Online
- Offline
- Attendance stored locally
- Waiting for synchronization
- Synchronizing
- Successfully synchronized
- Synchronization failed
- Duplicate prevented
- Record requires manual analysis

Clearly distinguish:

- “Ponto registrado no aparelho”
- “Ponto sincronizado com o servidor”

Never claim a record is fully confirmed before the server has validated it.

Show a small persistent synchronization indicator when records are pending.

Provide a manual “Sincronizar agora” action when appropriate.

Preserve idempotency and duplicate-prevention logic.

---

## 13. PERMISSION ONBOARDING

Create a first-access onboarding flow explaining why the application needs:

- Location
- Camera
- Notifications, when used

Use progressive permission requests.

Do not ask for every permission immediately on the first screen.

Explain the benefit before triggering the native browser permission dialog.

Example:

> Usamos sua localização somente no momento do registro para confirmar se você está na área de trabalho autorizada.

Include:

- Privacy explanation
- Permission status
- Recovery instructions
- Link to the relevant privacy policy

---

## 14. ACCESSIBILITY

Follow WCAG 2.2 AA principles.

Ensure:

- Sufficient color contrast
- Visible focus states
- Semantic HTML
- Keyboard accessibility
- Screen-reader labels
- Text alternatives
- Reduced-motion support
- Large touch targets
- Errors not communicated only through color
- Font sizes appropriate for mobile
- Form labels always visible
- Clear feedback after every user action

Do not disable zoom on mobile.

---

## 15. COMPONENTS TO CREATE OR REFACTOR

Create reusable components such as:

- `EmployeeAppShell`
- `MobileHeader`
- `AttendanceActionCard`
- `LiveClock`
- `WorkdayStatus`
- `LocationStatus`
- `GeofenceStatus`
- `SyncStatus`
- `DailySummary`
- `AttendanceTimeline`
- `AttendanceHistoryCard`
- `CameraVerification`
- `PermissionRequestCard`
- `AttendanceSuccessSheet`
- `AttendanceErrorSheet`
- `AdjustmentRequestForm`
- `StatusBadge`
- `EmptyState`
- `OfflineBanner`
- `BottomNavigation`
- `EmployeeProfileCard`
- `WorksiteInfoSheet`

Components must use existing Insight Apex primitives whenever available.

Avoid duplicating buttons, badges, dialogs, inputs, or card components that already exist in the design system.

---

## 16. TECHNICAL REQUIREMENTS

Preserve the current application architecture and business logic unless a refactor is clearly necessary.

Do not break:

- Employee authentication
- Invitation and activation flow
- Password creation
- Existing RBAC permissions
- `people.ponto_session_use` permission
- Manager approval and rejection flow
- Signed selfie URLs
- Audit persistence
- Geofence validation
- Attendance event validation
- Existing Supabase integration
- Existing middleware rules
- Existing API contracts
- Existing attendance records

Before changing code:

1. Inspect the repository structure.
2. Identify the framework, routing, state management, component library, and styling solution.
3. Identify existing Insight Apex design tokens and shared components.
4. Map current attendance business rules.
5. Identify all attendance states and edge cases.
6. Produce an implementation plan.
7. Implement the redesign incrementally.

Do not replace stable business logic only to simplify the UI refactor.

Use TypeScript with strict typing.

Avoid:

- `any`
- Duplicated state
- Hardcoded attendance rules
- Arbitrary colors
- Arbitrary spacing
- Inline styles without justification
- Duplicated API calls
- Unnecessary dependencies
- Large monolithic components

---

## 17. MOTION AND MICROINTERACTIONS

Use restrained motion to improve understanding.

Appropriate examples:

- Main attendance action press feedback
- Location validation transition
- Success confirmation
- Bottom-sheet entry
- Status change
- Timeline expansion
- Skeleton loading
- Offline-to-online synchronization feedback

Prefer the animation library already used by Insight Apex.

If none exists, use Motion in a minimal and tree-shakable way.

Respect `prefers-reduced-motion`.

Do not combine Motion, GSAP, anime.js, and react-spring in the same experience without a real architectural need.

---

## 18. EMPTY, LOADING, AND ERROR STATES

Design all relevant states, not only the ideal scenario.

Include:

- Initial loading
- Skeleton loading
- No attendance records
- No worksite assigned
- No internet
- GPS unavailable
- Camera unavailable
- Permission denied
- Server unavailable
- Session expired
- Invalid attendance sequence
- Duplicate attendance attempt
- Outside geofence
- Selfie upload failure
- Pending synchronization
- Adjustment request rejected
- Attendance under analysis

Every error must provide:

- What happened
- Why it matters
- What the employee can do next

---

## 19. LANGUAGE AND CONTENT

All employee-facing interface content must be in natural Brazilian Portuguese.

Use clear and direct language.

Prefer:

- “Registrar entrada”
- “Registrar saída”
- “Iniciar intervalo”
- “Encerrar intervalo”
- “Localização confirmada”
- “Fora da área autorizada”
- “Ponto salvo no aparelho”
- “Aguardando sincronização”

Avoid unnecessarily formal or technical language.

Do not use English labels in the final employee interface.

---

## 20. EXPECTED DELIVERABLES

Deliver:

1. Audit of the current Ponto interface
2. Audit of the existing Insight Apex design system
3. UX problems and risks identified
4. Proposed information architecture
5. Screen flow for the attendance journey
6. List of all application states
7. New responsive UI implementation
8. Reusable component architecture
9. Mobile, tablet, and desktop adaptations
10. Loading, empty, offline, success, and error states
11. Accessibility improvements
12. Tests for critical flows
13. Summary of changed files
14. Explanation of any business-logic changes
15. Screenshots or visual validation of the finished pages

---

## 21. CRITICAL USER FLOWS TO VALIDATE

Validate at least these flows:

### Flow 1

Login → location permission → clock-in → selfie → success

### Flow 2

Clock-in → start break → finish break → clock-out

### Flow 3

Employee outside geofence → attendance blocked or sent for analysis according to existing rules

### Flow 4

GPS permission denied → recovery instructions → permission granted → attendance completed

### Flow 5

Offline attendance → stored locally → connection restored → synchronized

### Flow 6

Duplicate attendance attempt → prevented with clear explanation

### Flow 7

Selfie upload fails → retry without losing captured attendance information

### Flow 8

Employee views attendance history and opens a day’s details

### Flow 9

Employee requests an attendance adjustment and tracks its status

### Flow 10

Session expires during attendance registration without creating an inconsistent record

---

## 22. ACCEPTANCE CRITERIA

The redesign is complete only when:

- The application visually belongs to the Insight Apex ecosystem.
- The main attendance action is immediately understandable.
- The employee always knows the current workday status.
- Location and geofence status are clearly communicated.
- Selfie verification is fast and understandable.
- Mobile navigation is simple and consistent.
- No important action depends only on color.
- Offline and pending-sync states are explicit.
- Attendance history is comfortable to read on mobile.
- The interface works from 320px upward.
- Existing attendance logic and security are preserved.
- No existing authentication, RBAC, audit, selfie, or geofence flow is broken.
- The result does not look like a generic template or AI-generated dashboard.
- The implementation is production-ready, typed, responsive, accessible, and maintainable.

---

## EXECUTION INSTRUCTION

Start by auditing the existing codebase and the Insight Apex design system.

Then present a concise implementation plan before modifying files.

After the plan, execute the redesign in logical phases and validate every critical attendance state.
