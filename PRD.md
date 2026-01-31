# GitterFlow PRD - Product Requirements Document

## Overview
GitterFlow is a CLI tool for managing git workflows with AI coding agents. It handles branching, status tracking, and merging for parallel agent development.

## Completed Features ✅
- [x] `gf new <task>` - Create agent branches from tasks
- [x] `gf status` - Show agent branch status  
- [x] `gf finish` - Merge completed work back
- [x] Config file support (.gitterflow.yaml)
- [x] Agent state tracking (.gitterflow/agents/)
- [x] Webhook notifications on completion

## In Progress 🔄
- [ ] Enhanced status display with commit history

## Backlog 📋

### Priority 1: Core Improvements
- [x] Add `--plan-first` flag to `gf new` (creates plan before coding) ✅
- [x] Add `gf spawn` command for batch spawning multiple agents ✅
- [ ] Add `gf watch` command for live monitoring agent progress
- [ ] Improve error handling with actionable messages
- [ ] Add `--dry-run` flag to preview operations

### Priority 2: Integration
- [ ] Add GitHub PR creation on finish (--pr flag)
- [ ] Add Linear issue status updates
- [ ] Improve Clawdbot session integration

### Priority 3: Polish
- [ ] Add `gf config` command for managing settings
- [ ] Add colored output for better readability
- [ ] Add `gf log` to show recent agent activity
- [ ] Comprehensive test coverage

## Technical Constraints
- TypeScript/Node.js codebase
- Must work with simple-git library
- Config uses cosmiconfig (yaml/json/js)
- CLI uses Commander.js

## Definition of Done
- Feature implemented and working
- No TypeScript errors
- Tests pass (if applicable)
- Code committed with clear message
