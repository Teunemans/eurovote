#!/usr/bin/env bash
# Publishes EuroVote on GitHub Pages in one go.
#
#   ./scripts/publish.sh            → repository called "eurovote"
#   ./scripts/publish.sh my-name    → repository called "my-name"
#
# What it does (each step prints what it is doing):
#   1. Installs the GitHub Pages workflow file into .github/workflows/
#   2. Downloads the national party list (public/data/parties.json)
#   3. Makes a git repository and a first commit
#   4. Creates a PUBLIC repository on your GitHub account (needs the GitHub CLI "gh")
#   5. Switches on GitHub Pages ("Source: GitHub Actions")
#   6. Pushes, which starts the first deploy, and waits for it to finish
#
# Safe to run again: steps that are already done are skipped.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="${1:-eurovote}"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

# ---------- checks ----------
command -v git  >/dev/null || fail "git is not installed."
command -v node >/dev/null || fail "Node.js is not installed (https://nodejs.org)."
if ! command -v gh >/dev/null; then
  fail "The GitHub CLI (gh) is not installed. Install it with:  brew install gh
  then log in with:  gh auth login   and run this script again."
fi
gh auth status >/dev/null 2>&1 || fail "You are not logged in to the GitHub CLI. Run:  gh auth login   and then this script again."
git config user.name >/dev/null || fail "git doesn't know your name yet. Run:
  git config --global user.name \"Your Name\"
  git config --global user.email \"you@example.com\""

# ---------- 1. workflow file ----------
step "1/6  Installing the GitHub Pages workflow"
mkdir -p .github/workflows
if ! cmp -s scripts/deploy-workflow.yml .github/workflows/deploy.yml 2>/dev/null; then
  cp scripts/deploy-workflow.yml .github/workflows/deploy.yml
  echo "    Copied scripts/deploy-workflow.yml → .github/workflows/deploy.yml"
else
  echo "    Already in place."
fi

# ---------- 2. party list ----------
step "2/6  Downloading the national party list"
node scripts/update-parties.mjs || echo "    (Failed, not a problem: GitHub will try again during the deploy.)"

# ---------- 3. git ----------
step "3/6  Making the first commit"
[ -d .git ] || git init -q -b main
git add .
if git diff --cached --quiet; then
  echo "    Nothing new to commit."
else
  git commit -q -m "Publish EuroVote"
  echo "    Committed."
fi
git branch -M main

# ---------- 4. GitHub repository ----------
step "4/6  Creating the public repository \"$REPO_NAME\" on GitHub"
OWNER="$(gh api user --jq .login)"
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "    github.com/$OWNER/$REPO_NAME already exists, using it."
else
  gh repo create "$REPO_NAME" --public --description "Readable charts of how countries, groups and parties voted in the European Parliament"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"

# ---------- 5. GitHub Pages ----------
step "5/6  Switching on GitHub Pages (source: GitHub Actions)"
if gh api "repos/$OWNER/$REPO_NAME/pages" >/dev/null 2>&1; then
  gh api --method PUT "repos/$OWNER/$REPO_NAME/pages" -f build_type=workflow >/dev/null
  echo "    Pages was already on; made sure it uses GitHub Actions."
else
  gh api --method POST "repos/$OWNER/$REPO_NAME/pages" -f build_type=workflow >/dev/null
  echo "    Done."
fi

# ---------- 6. push + deploy ----------
step "6/6  Pushing (this starts the deploy)"
if ! git push -u origin main; then
  fail "The push was refused. If the message mentions 'workflow' scope, run:
  gh auth refresh -s workflow
  and then this script again."
fi

echo "    Waiting for the deploy to start…"
sleep 8
RUN_ID="$(gh run list --repo "$OWNER/$REPO_NAME" --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
if [ -n "$RUN_ID" ]; then
  gh run watch "$RUN_ID" --repo "$OWNER/$REPO_NAME" --exit-status || echo "    The deploy reported a problem; see the Actions tab on GitHub."
fi

URL="$(gh api "repos/$OWNER/$REPO_NAME/pages" --jq .html_url 2>/dev/null || echo "https://$OWNER.github.io/$REPO_NAME/")"
printf '\n\033[32m✓ EuroVote is published at %s\033[0m\n' "$URL"
echo "  From now on, every 'git push' updates the site."
