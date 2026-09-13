FROM postgres:16-alpine
RUN apk add --no-cache bash findutils
COPY deploy/backup.sh deploy/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
 && echo '15 2 * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
