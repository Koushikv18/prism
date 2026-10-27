#!/usr/bin/env bash
# scripts/install-ollama.sh
# Automated macOS/Linux Ollama Installer and Service Starter for Prism
set -e

OLLAMA_HOST="http://localhost:11434"

info() { echo -e "\033[0;36m[INFO]\033[0m $1"; }
ok()   { echo -e "\033[0;32m[OK]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }
err()  { echo -e "\033[0;31m[ERR]\033[0m $1"; }

check_service() {
    curl -s --connect-timeout 2 "$OLLAMA_HOST/api/tags" > /dev/null 2>&1
}

info "Checking local Ollama service status at $OLLAMA_HOST..."

if check_service; then
    ok "Ollama service is already active and healthy."
    exit 0
fi

# 1. Install if command not found
if ! command -v ollama > /dev/null 2>&1; then
    warn "Ollama CLI not found in PATH. Initiating automatic install..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew > /dev/null 2>&1; then
            info "Homebrew detected. Installing via 'brew install ollama'..."
            brew install ollama
        else
            info "Downloading official macOS Ollama application..."
            curl -fsSL https://ollama.com/install.sh | sh
        fi
    else
        info "Running official Linux installation script..."
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    ok "Installation step completed."
fi

# 2. Start daemon in background
info "Launching 'ollama serve' in background..."
nohup ollama serve > /tmp/ollama-prism.log 2>&1 &

# 3. Poll for service ready
info "Waiting for Ollama to accept connections on port 11434..."
for i in {1..15}; do
    sleep 1
    if check_service; then
        ok "Ollama is now ONLINE and ready for Prism!"
        exit 0
    fi
done

err "Ollama service start timed out. Check /tmp/ollama-prism.log for logs."
exit 1
