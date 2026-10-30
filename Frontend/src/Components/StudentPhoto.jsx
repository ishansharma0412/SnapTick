import React, { useEffect, useState } from "react";
import { FiUser } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { cachedStudentPhoto, fetchStudentPhoto } from "../utils/studentPhoto";

const StudentPhoto = ({ student, className = "", alt }) => {
  const { token } = useAuth();
  const version = `${student.image || ""}`;
  const [src, setSrc] = useState(() => cachedStudentPhoto(student._id, version));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    fetchStudentPhoto(student._id, token, version)
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [student._id, token, version]);

  if (failed || !src) {
    return (
      <div className={`${className} flex items-center justify-center bg-[var(--bg-input)] text-[var(--text-muted)]`}>
        {failed ? <FiUser size={28} /> : <span className="h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      </div>
    );
  }
  return <img src={src} alt={alt || student.name} className={className} />;
};

export default StudentPhoto;
