#!/bin/sh

echo "Initializing pin 23"
gpio-admin export 23 pullup
