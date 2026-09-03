@echo off
REM Double-click this file to start the Forwarding Tracker app.
REM It opens two windows: one for the backend, one for the frontend.
REM Leave both windows open while you use the app. Close them (or press
REM Ctrl+C in each) when you're done.

start "Forwarding Tracker - Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn server:app --host 127.0.0.1 --port 8000 --reload"

start "Forwarding Tracker - Frontend" cmd /k "cd /d %~dp0frontend && yarn start"
