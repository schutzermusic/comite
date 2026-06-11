You are a senior full-stack engineer specialized in enterprise project controls, Gantt systems, MS Project schedule import, PDF parsing, project execution management, Next.js 15, TypeScript, Supabase, RBAC, Agenda/Tasks integration, notifications, and premium SaaS UI/UX.

I need to restructure the Projetos module into a full enterprise project controls platform.

The most important feature:
Inside each project, the Timeline tab must work like an editable Gantt. The system must allow importing a PDF exported from Microsoft Project, parse the project schedule, reconstruct the full WBS/Gantt structure, make it editable, interactive, assignable to internal employees, and integrated with Agenda, Tasks, Risks, Contracts, Finance and Notifications.

Context:
The uploaded MS Project PDF contains a schedule table with columns like:
- Id
- EDT / WBS
- Nome da Tarefa
- % concluída
- Duração
- Início
- Término

Example structure:
- Root project: CRO.2859.008.002-R00 - UTE - SRP - RJ Major Overhaul UG 02
- Project duration: 31 days
- Start: 19/05/2026
- Finish: 30/06/2026
- Main phases include:
  - Serviços em campo
  - Mobilização
  - Inspeções iniciais
  - Detalhamento da Desmontagem
  - Serviços em fábrica - Rotor
  - Serviços em Campo (Montagem)

Important:
PDF import should reconstruct what is available:
- WBS/EDT hierarchy
- task name
- duration
- start date
- finish date
- percent complete
- row order
- summary tasks vs leaf tasks

Do not invent missing data.
If predecessors, dependencies, resources or assignments are not present in the PDF, mark them as missing and allow the user to review/edit them manually.

━━━━━━━━━━━━━━━━━━
OBJECTIVE
━━━━━━━━━━━━━━━━━━

Transform Projetos into a complete enterprise project execution cockpit with:

1. Project list / portfolio view
2. Project detail cockpit
3. Editable Gantt timeline
4. MS Project PDF import
5. Timeline task assignment to internal employees
6. Delay management workflow
7. Notifications to responsible users
8. Agenda & Tasks integration
9. Contract integration
10. Finance integration
11. Risk integration
12. Documents and audit history

This must feel like a corporate project controls system, not a basic task list.

━━━━━━━━━━━━━━━━━━
1. PROJECT DETAIL STRUCTURE
━━━━━━━━━━━━━━━━━━

Create or improve the project detail page with these tabs:

- Overview
- Timeline / Gantt

Each tab must use the existing HUD/glass enterprise style.
Keep dark/light mode support.
No horizontal overflow.

━━━━━━━━━━━━━━━━━━
2. TIMELINE / GANTT REQUIREMENTS
━━━━━━━━━━━━━━━━━━

The Timeline tab must become an enterprise Gantt.

Required views:
- Gantt view
- WBS table view
- Vertical timeline view
- Calendar-linked view if feasible

Gantt layout:
- left side: task tree/grid
- right side: timeline bars
- collapsible WBS hierarchy
- summary tasks
- leaf tasks
- progress inside bars
- baseline overlay if available
- delayed/critical indicators
- dependency arrows if dependencies exist
- zoom: day / week / month
- today line
- scroll sync between task grid and timeline

Task grid columns:
- WBS / EDT
- Task name
- Type
- Status
- % complete
- Duration
- Planned start
- Planned finish
- Actual start
- Actual finish
- Forecast finish
- Responsible user
- Execution team
- Delay status
- Linked agenda task
- Linked risk
- Notes

Gantt item types:
- phase
- milestone
- deliverable
- task
- meeting
- decision
- document
- risk_event
- financial_event
- contract_event

Timeline task statuses:
- not_started
- in_progress
- blocked
- delayed
- completed
- cancelled

Each task should support:
- parent/child hierarchy
- planned dates
- actual dates
- forecast dates
- duration
- progress %
- responsible user
- execution team
- checklist
- comments
- attachments
- dependencies
- delay reason
- recovery plan
- linked agenda task
- linked risk
- linked document

━━━━━━━━━━━━━━━━━━
3. MS PROJECT PDF IMPORT
━━━━━━━━━━━━━━━━━━

Create an import workflow:

Button:
"Importar cronograma MS Project"

Supported file:
- PDF exported from MS Project
- optionally CSV/XLSX/XML in future

Import steps:
1. Upload file
2. Parse PDF text/table
3. Detect schedule columns
4. Extract rows
5. Build WBS hierarchy from EDT/WBS
6. Detect summary tasks vs leaf tasks
7. Normalize dates
8. Normalize duration
9. Normalize percent complete
10. Preview parsed schedule
11. Show validation issues
12. Let user confirm import
13. Create or update project timeline items
14. Create schedule version/import batch
15. Allow rollback or re-import

Parser must handle Portuguese MS Project PDF labels:
- Id
- EDT
- Nome da Tarefa
- % concluída
- Duração
- Início
- Término

Date examples:
- Ter 19/05/26
- Qua 20/05/26
- Seg 01/06/26

Duration examples:
- 31 dias
- 24,17 dias
- 1 dia
- 9 hrs
- 0,5 dias
- 0 hrs
- 2 diasd

Parsing rules:
- Convert dates to ISO.
- Convert durations to minutes/hours/days using a project calendar.
- Keep original raw values for audit.
- If a row cannot be parsed, flag it in the preview.
- If dependency/predecessor data does not exist in PDF, leave dependencies empty.
- Do not invent dependencies.
- If resource/user data does not exist in PDF, leave assignees empty and require assignment after import.

Validation:
- detect missing dates
- detect invalid durations
- detect child dates outside parent dates
- detect summary task inconsistencies
- detect duplicate WBS
- detect missing root task
- detect non-sequential IDs
- detect impossible date ranges

Preview UI:
- show imported rows
- show WBS hierarchy
- show number of tasks
- show phases
- show milestones
- show warnings
- show "Importar como novo cronograma"
- show "Atualizar cronograma existente"

━━━━━━━━━━━━━━━━━━
4. IMPORT VERSIONING / ANTI-DUPLICATION
━━━━━━━━━━━━━━━━━━

Do not duplicate timeline tasks on every import.

Create schedule import/versioning behavior.

Tables or fields should support:
- import_batch_id
- source_file_name
- source_file_hash
- imported_at
- imported_by
- schedule_version
- original_ms_project_id
- original_wbs_code
- original_task_name
- original_start_raw
- original_finish_raw
- original_duration_raw
- original_percent_raw

Matching logic for re-import:
Prefer matching by:
1. original_ms_project_id + WBS
2. WBS code
3. stable normalized task name + parent WBS
4. manual review if ambiguous

When re-importing:
- update existing items when matched
- create new items when new
- mark removed items as inactive or "not found in latest import"
- never hard-delete automatically
- show diff:
  - new tasks
  - changed dates
  - changed duration
  - changed progress
  - removed/missing tasks

━━━━━━━━━━━━━━━━━━
5. ASSIGNMENT / EXECUTION TEAM
━━━━━━━━━━━━━━━━━━

Each timeline task must allow assigning:

A. Responsible user
- one internal user
- accountable for updating status and delay reason

B. Execution team
- multiple internal users
- people who will execute that activity

Rules:
- responsible user must be internal
- execution team members must be internal
- external emails are not valid assignees for project task execution
- if external party is involved, use "external contact" or "supplier" field, not responsible_user_id

When assigning:
- send in-app notification
- send email notification
- create or update linked Agenda task if enabled

Task drawer should show:
- Responsible
- Execution team
- Add/remove team members
- Role on activity
- Notify team button
- Assignment history

━━━━━━━━━━━━━━━━━━
6. DELAY MANAGEMENT WORKFLOW
━━━━━━━━━━━━━━━━━━

If a task is delayed or at risk, the system must require responsible action.

Delay detection:
- current date > planned finish and task not completed
- forecast finish > planned finish
- predecessor delay impacts this task
- manual status = delayed / blocked

When delayed:
- show red/orange indicator in Gantt
- notify responsible user
- notify project manager
- create alert in project overview
- optionally create risk if delay impact is high

Responsible user must provide:
- reason for delay
- impact description
- new forecast finish
- recovery plan
- support needed
- whether client/contract impact exists

Delay reason categories:
- material delay
- logistics delay
- manpower delay
- client dependency
- technical issue
- supplier delay
- safety/compliance issue
- weather/external factor
- financial/payment issue
- other

Delay workflow:
1. System detects delay
2. Responsible receives notification
3. User opens task
4. User updates status/reason/forecast
5. Project manager is notified
6. Timeline and dashboard update
7. Delay is logged in history

If the responsible user does not respond:
- escalate after X days
- notify project manager/admin

━━━━━━━━━━━━━━━━━━
7. AGENDA & TASKS INTEGRATION
━━━━━━━━━━━━━━━━━━

Timeline must integrate with Agenda & Tarefas.

Behavior:
- Each Gantt task can create/link an Agenda task.
- Each milestone can create reminders.
- Each delayed activity can create a follow-up task.
- Meetings can be linked to timeline items.
- Agenda tasks linked to project appear in the project Agenda tab.
- Project timeline due dates appear in Agenda.

When creating a timeline item with responsible user:
Option:
"Create Agenda task for responsible"

When checked:
- create task in Agenda
- due date = timeline item planned finish
- assignee = responsible user
- related_project_id = current project
- related_timeline_item_id = current timeline item
- notify assignee

When timeline item changes:
- update linked Agenda task if not manually detached
- notify assignee if due date changed

Do not duplicate Agenda logic.
Reuse existing Agenda services and tables where possible.

━━━━━━━━━━━━━━━━━━
8. NOTIFICATIONS
━━━━━━━━━━━━━━━━━━

Notify internal users when:

- assigned as responsible
- added to execution team
- task date changes
- task becomes delayed
- delay reason is requested
- delay reason is submitted
- task is completed
- task is blocked
- milestone is approaching
- predecessor task completion affects their activity
- project manager changes schedule

Notification channels:
- in-app notification
- email
- future: WhatsApp/message if available

Notification must include:
- project name
- task name
- WBS
- due date
- status
- action required
- link to timeline task drawer

━━━━━━━━━━━━━━━━━━
9. PROJECT OVERVIEW DASHBOARD
━━━━━━━━━━━━━━━━━━

Project Overview should show:

KPIs:
- progress %
- planned progress
- schedule variance
- delayed tasks
- blocked tasks
- open risks
- critical path delay
- next milestone
- days remaining
- budget/actual/forecast
- margin

Charts:
- schedule progress curve
- S-curve planned vs actual if available
- task status distribution
- delay reasons distribution
- milestone timeline
- project risk summary
- cost curve

Alerts:
- delayed activities
- missing responsible users
- tasks without execution team
- overdue delay explanation
- upcoming milestones
- project finish at risk

━━━━━━━━━━━━━━━━━━
10. CONTRACT INTEGRATION
━━━━━━━━━━━━━━━━━━

Each project should link to a contract.

Project should have:
- contract_id
- default_cost_center_id
- business_unit_id
- client_id if available

Contract tab:
- linked contract summary
- contract value
- start/end date
- obligations
- billing milestones
- penalties/clauses if available
- contract documents

Timeline should support contract events:
- contract signing
- mobilization authorization
- delivery milestone
- client approval
- billing milestone
- contractual deadline
- penalty risk date

━━━━━━━━━━━━━━━━━━
11. FINANCE INTEGRATION
━━━━━━━━━━━━━━━━━━

Finance tab should use unified finance ledger.

Project financial view:
- revenue
- actual cost
- committed cost
- forecast cost
- margin
- BAC / AC / EAC if available
- cost by category
- cost by subcategory
- cost over time
- S-curve
- mobilization/logistics cost
- payroll allocation
- pending cost entries

Financial entries:
- selecting project should auto-fill default cost center
- project is the primary visible dimension
- cost center remains internal/default

Timeline can link financial events:
- billing milestone
- payment date
- major purchase
- mobilization cost event
- penalty risk

━━━━━━━━━━━━━━━━━━
12. RISK INTEGRATION
━━━━━━━━━━━━━━━━━━

Timeline items can create or link risks.

Examples:
- delayed critical activity creates schedule risk
- missing material creates supply risk
- rotor repair delay creates technical risk

Risk tab:
- project-scoped risk matrix
- delayed mitigation tasks
- linked timeline items
- AI-detected risks if existing

Click risk:
- open risk detail drawer
- show linked timeline item

━━━━━━━━━━━━━━━━━━
13. DOCUMENTS
━━━━━━━━━━━━━━━━━━

Timeline items and projects should support documents.

Document types:
- MS Project PDF
- schedule baseline
- technical report
- inspection evidence
- meeting minutes
- contract document
- invoice
- photo/evidence
- client approval

Each document can link to:
- project
- timeline item
- contract
- task
- risk

Use existing storage patterns where possible.

━━━━━━━━━━━━━━━━━━
14. DATA MODEL / SUPABASE
━━━━━━━━━━━━━━━━━━

Inspect existing project tables first.
Reuse existing schema where possible.

If missing, add safe migrations:

project_schedule_imports:
- id
- organization_id
- project_id
- source_file_name
- source_file_path
- source_file_hash
- source_type: ms_project_pdf | csv | xlsx | xml | manual
- schedule_version
- imported_by
- imported_at
- parse_status
- parse_summary jsonb
- warnings jsonb
- created_at

project_timeline_items:
- id
- organization_id
- project_id
- parent_id nullable
- import_batch_id nullable
- original_ms_project_id nullable
- wbs_code
- outline_level
- row_order
- type
- title
- description
- planned_start
- planned_finish
- actual_start
- actual_finish
- forecast_start
- forecast_finish
- duration_minutes
- percent_complete
- status
- priority
- responsible_user_id nullable
- delay_status
- delay_reason_category nullable
- delay_reason_text nullable
- delay_impact_text nullable
- recovery_plan_text nullable
- related_agenda_task_id nullable
- related_meeting_id nullable
- related_risk_id nullable
- related_contract_id nullable
- related_document_id nullable
- is_summary
- is_milestone
- is_active
- raw_import jsonb
- created_at
- updated_at
- deleted_at

project_timeline_dependencies:
- id
- organization_id
- project_id
- predecessor_id
- successor_id
- type: FS | SS | FF | SF
- lag_minutes
- created_at

project_timeline_assignments:
- id
- organization_id
- project_id
- timeline_item_id
- user_id
- role: responsible | executor | reviewer | approver
- assigned_by
- assigned_at
- removed_at

project_timeline_comments:
- id
- organization_id
- project_id
- timeline_item_id
- author_user_id
- body
- created_at

project_documents:
- id
- organization_id
- project_id
- timeline_item_id nullable
- file_path
- file_name
- file_type
- document_type
- uploaded_by
- uploaded_at
- deleted_at

project_delay_logs:
- id
- organization_id
- project_id
- timeline_item_id
- reported_by
- old_status
- new_status
- reason_category
- reason_text
- impact_text
- recovery_plan_text
- old_forecast_finish
- new_forecast_finish
- created_at

Make all tables organization-scoped.
Add RLS.
Add audit logs.

━━━━━━━━━━━━━━━━━━
15. RBAC
━━━━━━━━━━━━━━━━━━

Add or reuse permissions:
- projects.view
- projects.create
- projects.edit
- projects.delete
- projects.timeline.view
- projects.timeline.edit
- projects.timeline.import
- projects.timeline.assign
- projects.timeline.delay_update
- projects.timeline.admin
- projects.finance.view
- projects.documents.view
- projects.documents.upload
- projects.risks.manage

Rules:
- project members can view project
- project manager can edit project
- responsible user can update own assigned timeline items
- responsible user must provide delay reason when late
- project manager/admin can import schedule
- finance tab requires finance permission
- documents require document permission
- admin/owner can manage all

━━━━━━━━━━━━━━━━━━
16. UI / UX
━━━━━━━━━━━━━━━━━━

Design direction:
- premium enterprise project controls
- glass HUD
- high-density but readable
- dark/light mode
- no horizontal overflow
- responsive
- professional Gantt layout
- strong details drawer
- clear notifications/action requirements

Do not make it look like a basic Kanban or task app.
This is project controls for engineering/field execution.

━━━━━━━━━━━━━━━━━━
17. VALIDATION
━━━━━━━━━━━━━━━━━━

Run:
npm run typecheck
npm run lint
npm run build

Manual checks:
- Open project list.
- Open project detail.
- Timeline tab loads.
- Import MS Project PDF.
- Preview parsed WBS.
- Confirm import.
- Gantt renders hierarchy.
- Collapse/expand WBS.
- Edit dates.
- Assign responsible user.
- Add execution team.
- Responsible receives notification/email.
- Create Agenda task from timeline item.
- Agenda task appears in Agenda.
- Mark activity delayed.
- System requires delay reason and recovery plan.
- Project overview updates delayed task count.
- Re-import same PDF does not duplicate tasks.
- Re-import changed schedule shows diff.
- Contract tab still works.
- Finance tab still works.
- Risks tab still works.
- Documents upload works.
- No horizontal overflow.
- Dark/light mode readable.

━━━━━━━━━━━━━━━━━━
FINAL DELIVERY
━━━━━━━━━━━━━━━━━━

Report:
1. Files changed
2. Project module structure
3. MS Project PDF import behavior
4. Gantt/timeline behavior
5. Assignment and execution team behavior
6. Delay management workflow
7. Agenda/tasks integration
8. Notifications/email behavior
9. Contract/finance/risk/document integration
10. Data model/migrations
11. RBAC
12. Validation results
13. Remaining risks / next recommended phase
