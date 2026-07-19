# КАКАПО API + удаление фона фото (rembg / U^2-Net)
FROM node:20-bookworm-slim

WORKDIR /app

# Python + rembg для вырезания фона товаров на сервере
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/rembg-venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip install --no-cache-dir "rembg[cli]==2.0.59" onnxruntime==1.18.1

# Модель кладём в образ, чтобы первая загрузка не тянула её из интернета
ENV U2NET_HOME=/opt/rembg-models
ENV REMBG_MODEL=isnet-general-use
RUN mkdir -p $U2NET_HOME \
  && python3 -c "from rembg import new_session; new_session('isnet-general-use')"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY *.js ./

RUN mkdir -p /data
ENV DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 8000
CMD ["node", "index.js"]
