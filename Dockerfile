FROM python:3.11-slim

# Prevent python from buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies including Tesseract OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python packages first to leverage Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Render dynamically sets the PORT environment variable (defaults to 10000 on Render)
ENV PORT=10000
EXPOSE 10000

# Run Uvicorn listening on all interfaces and the port defined by Render
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
