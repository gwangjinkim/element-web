#!/bin/sh
# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
model_dir=${1:?Pass the model directory as the first argument}
mkdir -p "$model_dir"
fetch() {
    destination="$model_dir/$1"
    checksum=$2
    url=$3
    if [ ! -f "$destination" ]; then
        curl --fail --location --retry 2 "$url" --output "$destination.partial"
        printf '%s  %s\n' "$checksum" "$destination.partial" | sha256sum --check --status
        mv "$destination.partial" "$destination"
    fi
    printf '%s  %s\n' "$checksum" "$destination" | sha256sum --check
}
fetch model.gguf 044b313d29342bd3b2c77cbb64023ca0d209bd9b3247763f9d162767ef2d746a \
    https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF/resolve/3a0eca6ce931d88d00614d427ab3ed8ff0743902/Index-Translate-2B.Q4_K_M.gguf
fetch lid.176.bin 7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e \
    https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin
