#!/usr/bin/env sh
# Regenerate packages/protocol/vectors/firmware_vectors.json from the firmware's own framing code.
set -eu
cd "$(dirname "$0")"
cc -std=c99 -Wall -Wextra -Werror -O1 -Istub -Ivendor gen_vectors.c vendor/nrf_link.c -o gen_vectors
./gen_vectors > ../packages/protocol/vectors/firmware_vectors.json
echo "wrote packages/protocol/vectors/firmware_vectors.json"
