FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY server_v3.py .
COPY server_v4.py .
COPY server_v5.py .
COPY dist ./dist
ENV PORT=8000
EXPOSE 8000
USER 65534:65534
CMD ["python", "server_v5.py"]
