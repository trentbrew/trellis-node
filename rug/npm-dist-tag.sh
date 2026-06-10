#!/usr/bin/env bash
set -euo pipefail
cd /Users/trentbrew/TURTLE/Projects/TRELLIS/trellis-node
set -a
source .env
set +a
npm dist-tag add trellis@3.2.0 latest
npm view trellis dist-tags
