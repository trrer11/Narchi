FROM eclipse-temurin:17-jre
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kosit
COPY pins.env fetch.sh server.py /opt/kosit/
RUN chmod +x /opt/kosit/fetch.sh
ENV KOSIT_CACHE=/work/cache
ENV KOSIT_PORT=18080
EXPOSE 18080
HEALTHCHECK --interval=20s --timeout=5s --start-period=120s --retries=8 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18080/health', timeout=4)"
ENTRYPOINT ["/bin/bash", "-c", "/opt/kosit/fetch.sh && exec python3 /opt/kosit/server.py"]
