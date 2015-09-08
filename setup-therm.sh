#!/bin/sh

echo "Setting Up Thermometer..."
sudo modprobe w1-gpio
sudo modprobe w1-therm
