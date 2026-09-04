# ---- Stage 1：构建 ----
FROM golang:1.23-alpine AS builder
WORKDIR /src
# 依赖缓存（go.mod/go.sum 变化才重建该层）
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/zhiwellcare-server ./cmd/server

# ---- Stage 2：运行（migrations 需打进镜像） ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 zwkl
WORKDIR /app
COPY --from=builder /out/zhiwellcare-server /app/zhiwellcare-server
COPY migrations /app/migrations
USER zwkl
EXPOSE 8080
ENV APP_ADDR=:8080
ENTRYPOINT ["/app/zhiwellcare-server"]
