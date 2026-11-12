use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, RootCertStore};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;

/**
 * Configuration of the TLS connections opened by the proxy.
 */
#[derive(Clone, Debug, Default)]
pub struct TlsConfig {
    /// Disables the verification of the certificate (development only).
    pub insecure: bool,
    /// Additional certificates to trust, in PEM format.
    pub ca: Option<String>,
}

/**
 * Size of the buffers used to move the encrypted bytes.
 */
const TLS_BUFFER_SIZE: usize = 16 * 1024;

/**
 * A verifier that accepts any certificate.
 *
 * It is only used when the verification is explicitly disabled, which is useful to
 * talk with a development server that uses a self signed certificate.
 */
struct NoVerification(Arc<rustls::crypto::CryptoProvider>);

impl std::fmt::Debug for NoVerification {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("NoVerification")
    }
}

impl ServerCertVerifier for NoVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/**
 * Decodes the PEM certificates of a bundle.
 */
fn decode_pem_certificates(pem: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let mut certificates = Vec::new();
    let mut current: Option<String> = None;

    for line in pem.lines() {
        let line = line.trim();

        if line.starts_with("-----BEGIN CERTIFICATE-----") {
            current = Some(String::new());
            continue;
        }

        if line.starts_with("-----END CERTIFICATE-----") {
            let encoded = current.take().ok_or("malformed PEM certificate")?;
            let der = STANDARD
                .decode(encoded.as_bytes())
                .map_err(|err| format!("invalid PEM certificate: {}", err))?;
            certificates.push(CertificateDer::from(der));
            continue;
        }

        if let Some(buffer) = current.as_mut() {
            buffer.push_str(line);
        }
    }

    if certificates.is_empty() {
        return Err("the PEM bundle does not contain any certificate".to_string());
    }

    Ok(certificates)
}

/**
 * A reader over a slice, used to feed rustls with the bytes read from the socket.
 */
struct SliceReader<'a> {
    data: &'a [u8],
    position: usize,
}

impl io::Read for SliceReader<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let available = &self.data[self.position..];
        let length = available.len().min(buf.len());

        buf[..length].copy_from_slice(&available[..length]);
        self.position += length;

        Ok(length)
    }
}

/**
 * A writer over a vector, used to collect the bytes produced by rustls.
 */
struct SliceWriter<'a> {
    data: &'a mut Vec<u8>,
}

impl io::Write for SliceWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.data.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/**
 * A TLS client connection running over a Tokio socket.
 *
 * The handshake and the encrypted traffic are driven manually, so the connection can
 * be used from the asynchronous proxy without blocking the runtime.
 */
pub struct TlsStream {
    tls: ClientConnection,
    socket: TcpStream,
    /// The decrypted bytes that have not been consumed yet.
    plaintext: Vec<u8>,
    plaintext_pos: usize,
    /// The encrypted bytes that have not been written to the socket yet.
    pending: Vec<u8>,
    pending_pos: usize,
}

impl TlsStream {
    /**
     * Connects to the server and performs the TLS handshake.
     */
    pub async fn connect(
        socket: TcpStream,
        server_name: &str,
        config: &TlsConfig,
    ) -> io::Result<Self> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());

        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        if let Some(pem) = &config.ca {
            let certificates = decode_pem_certificates(pem)
                .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err))?;
            roots.add_parsable_certificates(certificates);
        }

        let builder = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .map_err(|err| io::Error::other(err.to_string()))?;

        let client_config = if config.insecure {
            // The verification is disabled explicitly: the certificate is not checked.
            builder
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(NoVerification(provider)))
                .with_no_client_auth()
        } else {
            builder.with_root_certificates(roots).with_no_client_auth()
        };

        let name = ServerName::try_from(server_name.to_string())
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err.to_string()))?;

        let tls = ClientConnection::new(Arc::new(client_config), name)
            .map_err(|err| io::Error::other(err.to_string()))?;

        let mut stream = Self {
            tls,
            socket,
            plaintext: Vec::new(),
            plaintext_pos: 0,
            pending: Vec::new(),
            pending_pos: 0,
        };

        stream.handshake().await?;

        Ok(stream)
    }

    /**
     * Performs the TLS handshake, feeding the socket into the state machine.
     */
    async fn handshake(&mut self) -> io::Result<()> {
        let mut buffer = vec![0u8; TLS_BUFFER_SIZE];

        while self.tls.is_handshaking() {
            self.flush_ciphertext().await?;

            let read = self.socket.read(&mut buffer).await?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "the TLS handshake was interrupted",
                ));
            }

            let mut reader = SliceReader {
                data: &buffer[..read],
                position: 0,
            };

            self.tls
                .read_tls(&mut reader)
                .map_err(|err| io::Error::other(err.to_string()))?;
            self.tls
                .process_new_packets()
                .map_err(|err| io::Error::other(err.to_string()))?;
        }

        self.flush_ciphertext().await?;

        Ok(())
    }

    /**
     * Collects the ciphertext that rustls wants to send.
     *
     * @returns `true` when there is new data to write.
     */
    fn take_ciphertext(&mut self) -> io::Result<bool> {
        if !self.tls.wants_write() {
            return Ok(false);
        }

        let mut buffer = Vec::with_capacity(TLS_BUFFER_SIZE);

        {
            let mut writer = SliceWriter { data: &mut buffer };
            self.tls
                .write_tls(&mut writer)
                .map_err(|err| io::Error::other(err.to_string()))?;
        }

        if buffer.is_empty() {
            return Ok(false);
        }

        self.pending = buffer;
        self.pending_pos = 0;

        Ok(true)
    }

    /**
     * Writes the pending ciphertext into the socket.
     */
    async fn flush_ciphertext(&mut self) -> io::Result<()> {
        loop {
            if self.pending_pos < self.pending.len() {
                let remaining = self.pending[self.pending_pos..].to_vec();
                self.socket.write_all(&remaining).await?;
                self.pending.clear();
                self.pending_pos = 0;
                continue;
            }

            if !self.take_ciphertext()? {
                break;
            }
        }

        Ok(())
    }

    /**
     * Writes the pending ciphertext into the socket, without blocking.
     */
    fn poll_flush_ciphertext(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        loop {
            if self.pending_pos < self.pending.len() {
                match Pin::new(&mut self.socket).poll_write(cx, &self.pending[self.pending_pos..]) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                    Poll::Ready(Ok(0)) => {
                        return Poll::Ready(Err(io::Error::new(
                            io::ErrorKind::WriteZero,
                            "the socket did not accept the data",
                        )))
                    }
                    Poll::Ready(Ok(written)) => {
                        self.pending_pos += written;
                        if self.pending_pos >= self.pending.len() {
                            self.pending.clear();
                            self.pending_pos = 0;
                        }
                    }
                }
                continue;
            }

            match self.take_ciphertext() {
                Ok(false) => return Poll::Ready(Ok(())),
                Ok(true) => {}
                Err(err) => return Poll::Ready(Err(err)),
            }
        }
    }

    /**
     * Copies the decrypted bytes that are already available into `buf`.
     */
    fn take_plaintext(&mut self, buf: &mut [u8]) -> usize {
        if self.plaintext_pos >= self.plaintext.len() {
            self.plaintext.clear();
            self.plaintext_pos = 0;
            return 0;
        }

        let available = &self.plaintext[self.plaintext_pos..];
        let length = available.len().min(buf.len());

        buf[..length].copy_from_slice(&available[..length]);
        self.plaintext_pos += length;

        length
    }

    /**
     * Extracts the plaintext that the state machine has already decrypted.
     */
    fn collect_plaintext(&mut self) -> io::Result<()> {
        let mut decrypted = Vec::new();
        let mut chunk = [0u8; 4096];

        {
            let mut reader = self.tls.reader();

            loop {
                match io::Read::read(&mut reader, &mut chunk) {
                    Ok(0) => break,
                    Ok(length) => decrypted.extend_from_slice(&chunk[..length]),
                    // No more plaintext is available yet.
                    Err(err) if err.kind() == io::ErrorKind::WouldBlock => break,
                    Err(err) => return Err(err),
                }
            }
        }

        self.plaintext = decrypted;
        self.plaintext_pos = 0;

        Ok(())
    }
}

impl AsyncRead for TlsStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();

        loop {
            let target = buf.initialize_unfilled();
            let length = this.take_plaintext(target);

            if length > 0 {
                buf.advance(length);
                return Poll::Ready(Ok(()));
            }

            let mut raw = vec![0u8; TLS_BUFFER_SIZE];
            let mut read_buf = ReadBuf::new(&mut raw);

            match Pin::new(&mut this.socket).poll_read(cx, &mut read_buf) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                Poll::Ready(Ok(())) => {
                    let read = read_buf.filled().len();

                    if read == 0 {
                        // The peer closed the connection.
                        return Poll::Ready(Ok(()));
                    }

                    let mut reader = SliceReader {
                        data: read_buf.filled(),
                        position: 0,
                    };

                    if let Err(err) = this.tls.read_tls(&mut reader) {
                        return Poll::Ready(Err(io::Error::other(err.to_string())));
                    }

                    if let Err(err) = this.tls.process_new_packets() {
                        return Poll::Ready(Err(io::Error::other(err.to_string())));
                    }

                    if let Err(err) = this.collect_plaintext() {
                        return Poll::Ready(Err(err));
                    }
                }
            }
        }
    }
}

impl AsyncWrite for TlsStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();

        let result = {
            let mut writer = this.tls.writer();
            io::Write::write_all(&mut writer, buf)
        };

        if let Err(err) = result {
            return Poll::Ready(Err(err));
        }

        match this.poll_flush_ciphertext(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(err)) => Poll::Ready(Err(err)),
            Poll::Ready(Ok(())) => Poll::Ready(Ok(buf.len())),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        this.poll_flush_ciphertext(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();

        let result = {
            let mut writer = this.tls.writer();
            io::Write::flush(&mut writer)
        };

        if let Err(err) = result {
            return Poll::Ready(Err(err));
        }

        this.poll_flush_ciphertext(cx)
    }
}
