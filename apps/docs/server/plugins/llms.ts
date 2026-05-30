export default defineNitroPlugin((app) => {
  app.hooks.hook("llms:generate:full", (e, opts, content) => {
    content.unshift(`# Trellis Documentation

> **Note:** This documentation corresponds to the current local-first Trellis architecture and roadmap.
 `);

    content.push(`## More Information

- [Trellis repository](https://github.com/trentbrew/trellis)
- [Trellis package](https://www.npmjs.com/package/trellis)`);
    content.push(`## Contact Information

- [GitHub](https://github.com/trentbrew)
- [Website](https://turtle.tech)
- [Email](mailto:tbrew@turtle.tech)`);
  });
});
