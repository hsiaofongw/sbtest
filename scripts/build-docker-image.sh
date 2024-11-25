#!/bin/bash

if [ -z "$1" ]; then
  echo "Expects tagname as parameter \$1."
  exit 1
fi

TAG=$1

SCRIPT_PATH=$(dirname $0)
DOCKER_PATH=$(realpath "$SCRIPT_PATH/../")
DOCKER_FILE="Dockerfile"

echo Building, tag is: $TAG
echo Dockerfile Path: $DOCKER_PATH
echo Dockerfile Name: $DOCKER_FILE

docker build \
  --target run \
  --tag sbtest:0.1 \
  -f $DOCKER_FILE \
  $DOCKER_PATH
