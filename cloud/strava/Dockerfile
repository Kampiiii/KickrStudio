FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Standard: Token-Dienst. Der Abgleich-Job nutzt dasselbe Image mit dem Befehl "python sync.py".
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 60 broker:app
