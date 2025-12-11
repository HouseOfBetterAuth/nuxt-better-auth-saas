# Syncing Updates from nuxt-better-auth-saas

This guide explains how to safely merge updates from the upstream template repository.

## Quick Start

```bash
# Preview what would change (no actual merge)
pnpm sync:upstream:dry-run

# Actually sync (with backup and confirmation)
pnpm sync:upstream

# Sync without creating a backup branch
pnpm sync:upstream:no-backup
```

## What the Script Does

### 1. Safety Checks
- ✅ Warns if you're not on `main` branch
- ✅ Checks for uncommitted changes (prevents data loss)
- ✅ Verifies the `template` remote exists

### 2. Preview Changes
- 📊 Shows how many new commits are available
- 📝 Lists recent commit messages
- 📁 Shows which files will be modified
- 🔍 **Analyzes potential conflicts** - identifies files modified in both branches

### 3. Backup (default)
- 💾 Creates a backup branch before merging (e.g., `backup-before-sync-20250115-143022`)
- 🔄 Easy to restore if something goes wrong

### 4. Merge
- 🔀 Merges `template/main` into your current branch
- 📝 Creates a descriptive merge commit
- ⚠️ Handles conflicts gracefully with clear instructions

## Conflict Detection

The script analyzes files that were modified in **both** your branch and upstream. These are likely to have conflicts:

```
⚠️  WARNING: Found 3 file(s) that may have conflicts:
  • app/components/UserNavigation.vue
  • server/utils/auth.ts
  • shared/utils/plans.ts
```

**Note:** This is a prediction. Git will detect actual conflicts during the merge.

## Handling Conflicts

If conflicts occur during merge:

### 1. See which files have conflicts
```bash
git status
```

### 2. Open each conflicted file
Look for conflict markers:
```
<<<<<<< HEAD
Your changes here
=======
Upstream changes here
>>>>>>> template/main
```

**Note:** The conflict markers above are just an example. When you see them in actual files, you'll need to resolve them.

### 3. Resolve conflicts
- Keep your changes
- Keep upstream changes
- Combine both
- Write something new

### 4. Stage resolved files
```bash
git add <resolved-file>
```

### 5. Complete the merge
```bash
git commit
```

### 6. Or abort if needed
```bash
git merge --abort
```

### Using a Merge Tool
For easier conflict resolution:
```bash
git mergetool
```

## Restoring from Backup

If something went wrong:

```bash
# Abort the merge first (if in progress)
git merge --abort

# Restore from backup
git reset --hard backup-before-sync-YYYYMMDD-HHMMSS
```

## Best Practices

1. **Always test after syncing** - Run your test suite (`pnpm test`) and manually test critical features
2. **Review changes** - Use `git log --oneline -10` to see what changed
3. **Check diffs** - Use `git diff HEAD~1` to see the full diff
4. **Sync regularly** - Don't let too many changes accumulate
5. **Document customizations** - Keep track of files you've heavily customized

## Common Files That May Conflict

Based on typical customizations, these files often have conflicts:

- `app/components/UserNavigation.vue` - Navigation customizations
- `server/utils/auth.ts` - Auth configuration
- `shared/utils/plans.ts` - Pricing plans
- `nuxt.config.ts` - Nuxt configuration
- `package.json` - Dependencies
- Email templates in `emails/`
- Database schema files

## Troubleshooting

### "Remote 'template' not found"
Make sure the remote is configured:
```bash
git remote -v
```

If missing, add it:
```bash
git remote add template https://github.com/HouseOfBetterAuth/nuxt-better-auth-saas.git
```

### "You have uncommitted changes"
Commit or stash your changes first:
```bash
git stash
# ... run sync ...
git stash pop
```

### Too many conflicts?
Consider cherry-picking specific commits instead:
```bash
git log template/main --oneline
git cherry-pick <commit-hash>
```
