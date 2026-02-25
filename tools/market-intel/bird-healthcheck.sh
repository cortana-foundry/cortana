#!/bin/bash
# Quick bird auth check - returns 0 if healthy, 1 if degraded
bird check 2>&1 | grep -q "ok" && exit 0 || exit 1
