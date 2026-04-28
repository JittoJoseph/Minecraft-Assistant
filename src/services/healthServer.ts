import http from "node:http";

export function startHealthServer(): void {
  const port = Number(process.env.PORT || 3000);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
  });

  server.listen(port, "0.0.0.0");
}
