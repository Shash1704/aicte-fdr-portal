// Browser stand-in for multer (memory storage): reads files from the request's FormData into
// req.files with the same shape as multer: { fieldname, originalname, mimetype, size, buffer }.
import { HttpError } from '../../../../server/src/instruments.js';

function multer({ limits = {}, fileFilter } = {}) {
  const collect = async (req, next) => {
    const form = req._form;
    req.files = [];
    if (!form) return next();
    for (const [field, f] of form.entries()) {
      if (typeof f !== 'object') continue;
      if (limits.fileSize && f.size > limits.fileSize) return next(new HttpError(400, `File too large: ${f.name}`));
      const file = { fieldname: field, originalname: f.name, mimetype: f.type || 'application/octet-stream', size: f.size };
      let accepted = true;
      let filterError = null;
      if (fileFilter) fileFilter(req, file, (err, ok) => { filterError = err; accepted = ok; });
      if (filterError) return next(filterError);
      if (!accepted) continue;
      file.buffer = new Uint8Array(await f.arrayBuffer());
      req.files.push(file);
    }
    next();
  };
  return { any: () => (req, _res, next) => collect(req, next), array: () => (req, _res, next) => collect(req, next) };
}
multer.memoryStorage = () => ({});
export default multer;
